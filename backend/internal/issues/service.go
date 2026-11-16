package issues

import (
	"context"
	"errors"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

// Actor is the verified user behind a request; the handler fills it from the cookie, never from a body.
type Actor struct{ Sub, DisplayName, Email string }

// Patch is what a client may change; nil leaves a field as it is. There is no field for the stamps or
// the external URL, so a client cannot send them.
type Patch struct {
	Status         *string `json:"status"`
	Assignee       *string `json:"assignee"`
	Note           *string `json:"note"`
	ExternalSystem *string `json:"externalSystem"`
	ExternalID     *string `json:"externalId"`
}

// Page is one page of List.
type Page struct {
	Issues []Issue `json:"issues"`
	Total  int     `json:"total"`
}

// Assignee is one entry of the pick list.
type Assignee struct {
	Sub         string `json:"sub"`
	DisplayName string `json:"displayName"`
}

// KnownUser is a user the backend has seen on a verified request.
type KnownUser struct{ Sub, DisplayName, Email string }

// defaultRateBudget bounds how long one bulk run waits on ServiceNow rate limits before it defers the rest.
const defaultRateBudget = 60 * time.Second

func sleepContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ErrNotFound is returned by Patch for an unknown id.
var ErrNotFound = errors.New("Issue not found")

// IsNotFound reports whether err means the issue does not exist (HTTP 404).
func IsNotFound(err error) bool { return errors.Is(err, ErrNotFound) }

// Service is the issues use cases on top of the store.
type Service struct {
	store       *Store
	urlTemplate string
	schemaN     string // the default namespace's /schema graph + "#": where changelog/annotations/shared queries mint
	schema      string
	tickets     TicketCreator // nil when the ServiceNow integration is off
	pusher      TicketPusher  // nil until EnablePush
	ticketOpts  TicketOptions
	sleep       func(context.Context, time.Duration) error // pauses a bulk run on a rate limit; replaced in tests
	rateBudget  time.Duration                              // total pause a bulk run may spend on rate limits
}

// NewService builds a Service. urlTemplate is the validated ISSUE_TRACKER_URL_TEMPLATE, or "".
func NewService(store *Store, defaultNamespaceBaseIRI, urlTemplate string) *Service {
	g := sparqlsafe.NamespaceGraphs(defaultNamespaceBaseIRI)
	return &Service{store: store, urlTemplate: urlTemplate, schema: g.Schema, schemaN: g.Schema + "#", sleep: sleepContext, rateBudget: defaultRateBudget}
}

// ExternalURL fills `{id}` of the template with the escaped external id; "" without either.
func ExternalURL(template, externalID string) string {
	if template == "" || externalID == "" {
		return ""
	}
	return strings.ReplaceAll(template, "{id}", url.QueryEscape(externalID))
}

func (s *Service) decorate(i Issue) Issue {
	i.ExternalURL = ExternalURL(s.urlTemplate, i.ExternalID)
	return i
}

// Reconcile runs the lifecycle of one validation run (see Reconcile) and adds the external URLs.
func (s *Service) Reconcile(ctx context.Context, violations []validation.Violation, notChecked []validation.NotChecked, by Actor, at string) (Run, error) {
	var opts []ReconcileOption
	if s.ticketOpts.NoAutoPush {
		opts = append(opts, WithoutPush())
	}
	run, err := Reconcile(ctx, s.store, violations, notChecked, by.Sub, by.DisplayName, at, opts...)
	if err != nil {
		return Run{}, err
	}
	for i := range run.Outcomes {
		run.Outcomes[i].ExternalURL = ExternalURL(s.urlTemplate, run.Outcomes[i].issue.ExternalID)
	}
	return run, nil
}

// Report is the stored result of the last run: the findings (the issues that run saw again), one
// outcome per finding, what it could not check and when it ran. Before the first run it is empty.
type Report struct {
	RunAt      string                  `json:"runAt"`
	Violations []validation.Violation  `json:"violations"`
	NotChecked []validation.NotChecked `json:"notChecked"`
	Issues     []Outcome               `json:"issues"`
}

// Report reads the last run back from the issues graph.
func (s *Service) Report(ctx context.Context) (Report, error) {
	rep := Report{Violations: []validation.Violation{}, NotChecked: []validation.NotChecked{}, Issues: []Outcome{}}
	rec, ok, err := s.store.LastRun(ctx)
	if err != nil || !ok {
		return rep, err
	}
	all, err := s.store.All(ctx)
	if err != nil {
		return Report{}, err
	}
	rep.RunAt, rep.NotChecked = rec.At, rec.NotChecked
	for _, i := range all {
		if i.LastSeenAt != rec.At {
			continue
		}
		rep.Violations = append(rep.Violations, validation.Violation{
			ID: i.ID, IndividualIri: i.IndividualIri, IndividualLabel: i.IndividualLabel, TypeIri: i.TypeIri, Path: i.Path,
			Constraint: i.Constraint, Message: i.Message, RuleId: i.RuleId, QualityDimension: i.QualityDimension, ShapeIri: i.ShapeIri, Value: i.Value,
		})
		rep.Issues = append(rep.Issues, Outcome{FindingID: i.ID, IssueID: i.ID, Status: i.Status, Assignee: i.Assignee, ExternalURL: ExternalURL(s.urlTemplate, i.ExternalID)})
	}
	return rep, nil
}

// List returns a filtered, bounded page with the total count.
func (s *Service) List(ctx context.Context, f Filter) (Page, error) {
	items, err := s.store.List(ctx, f)
	if err != nil {
		return Page{}, err
	}
	total, err := s.store.Count(ctx, f)
	if err != nil {
		return Page{}, err
	}
	for i := range items {
		items[i] = s.decorate(items[i])
	}
	return Page{Issues: items, Total: total}, nil
}

// Patch applies p to the issue and stamps the change with the actor and `at`.
func (s *Service) Patch(ctx context.Context, id string, p Patch, by Actor, at string) (Issue, error) {
	i, ok, err := s.store.Get(ctx, id)
	if err != nil {
		return Issue{}, err
	}
	if !ok {
		return Issue{}, ErrNotFound
	}
	if p.Status != nil && *p.Status != i.Status {
		if !validStatus(*p.Status) {
			return Issue{}, inputErrorf("Invalid status")
		}
		i.Status = *p.Status
		i.ResolvedBy = ""
		if i.Status == StatusResolved || i.Status == StatusWontFix {
			i.ResolvedBy = by.Sub
		}
		if i.Status == StatusWontFix && !s.ticketOpts.NoAutoPush {
			i = markPending(i) // ServiceNow learns of the decision on the next push
		}
	}
	if p.Assignee != nil {
		sub := strings.TrimSpace(*p.Assignee)
		if len(sub) > MaxSub {
			return Issue{}, inputErrorf("The assignee is too long")
		}
		// ServiceNow owns the assignee while the ticket is open (research D2)
		if cur, ok := i.CurrentTicket(); ok && s.tickets != nil && sub != i.Assignee && !s.tickets.TicketClosed(cur.State) {
			return Issue{}, conflictf("The assignee is set in ServiceNow while ticket %s is open", cur.Number)
		}
		i.Assignee, i.AssigneeName = sub, ""
		if sub != "" {
			i.AssigneeName = s.nameOf(ctx, sub, by)
		}
	}
	if p.Note != nil {
		i.Note = *p.Note
	}
	if p.ExternalSystem != nil {
		i.ExternalSystem = strings.TrimSpace(*p.ExternalSystem)
	}
	if p.ExternalID != nil {
		i.ExternalID = strings.TrimSpace(*p.ExternalID)
	}
	i.UpdatedBy, i.UpdatedByName, i.UpdatedAt = by.Sub, by.DisplayName, at
	if err := s.store.Update(ctx, i); err != nil {
		return Issue{}, err
	}
	return s.decorate(i), nil
}

func (s *Service) nameOf(ctx context.Context, sub string, by Actor) string {
	if sub == by.Sub {
		return by.DisplayName
	}
	if users, err := s.store.KnownUsers(ctx); err == nil {
		for _, u := range users {
			if u.Sub == sub && u.DisplayName != "" {
				return u.DisplayName
			}
		}
	}
	return sub
}

// Assignees is the pick list: every known user, every bare sub seen as an author elsewhere, and the
// caller, de-duplicated by sub and sorted by display name.
func (s *Service) Assignees(ctx context.Context, caller Actor) ([]Assignee, error) {
	users, err := s.store.KnownUsers(ctx)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	for _, u := range users {
		names[u.Sub] = u.DisplayName
	}
	subs, err := s.store.seenSubs(ctx, s.schema, s.schemaN)
	if err != nil {
		return nil, err
	}
	for _, sub := range subs {
		if _, ok := names[sub]; !ok {
			names[sub] = ""
		}
	}
	if caller.Sub != "" {
		names[caller.Sub] = caller.DisplayName
	}
	out := make([]Assignee, 0, len(names))
	for sub, name := range names {
		if sub == "" || sub == SystemUser {
			continue
		}
		if name == "" {
			name = sub
		}
		out = append(out, Assignee{Sub: sub, DisplayName: name})
	}
	sort.Slice(out, func(a, b int) bool {
		la, lb := strings.ToLower(out[a].DisplayName), strings.ToLower(out[b].DisplayName)
		if la != lb {
			return la < lb
		}
		return out[a].Sub < out[b].Sub
	})
	return out, nil
}

// Directory remembers the users `GET /me` sees. A write happens only when the name or email changed or
// the last write is older than `ttl`; the cache is in memory, so a restart simply writes once more.
type Directory struct {
	store *Store
	ttl   time.Duration
	now   func() time.Time

	mu    sync.Mutex
	cache map[string]dirEntry
}

type dirEntry struct {
	name, email string
	at          time.Time
}

// NewDirectory builds a Directory that writes at most once per day per unchanged user.
func NewDirectory(store *Store) *Directory {
	return &Directory{store: store, ttl: 24 * time.Hour, now: time.Now, cache: map[string]dirEntry{}}
}

// Remember upserts u as a KnownUser unless the cache says it is current. The caller passes only
// verified identity (the cookie), never a client body.
func (d *Directory) Remember(ctx context.Context, u KnownUser) error {
	if u.Sub == "" {
		return nil
	}
	now := d.now()
	d.mu.Lock()
	e, ok := d.cache[u.Sub]
	d.mu.Unlock()
	if ok && e.name == u.DisplayName && e.email == u.Email && now.Sub(e.at) < d.ttl {
		return nil
	}
	if err := d.store.UpsertKnownUser(ctx, u, now.UTC().Format("2006-01-02T15:04:05.000Z")); err != nil {
		return err
	}
	d.mu.Lock()
	d.cache[u.Sub] = dirEntry{name: u.DisplayName, email: u.Email, at: now}
	d.mu.Unlock()
	return nil
}
