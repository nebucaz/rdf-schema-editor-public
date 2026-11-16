package servicenow

import (
	"context"
	"log"
	"reflect"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

// watermarkOverlap is how far a poll looks back before the stored watermark, so a ticket updated in the
// same second as the last one seen is never missed; applying a change twice is a no-op.
const watermarkOverlap = time.Minute

// maxText is the longest text copied onto an issue (the store's own limit).
const maxText = 2000

// IssueRepo is the slice of the issues store the syncer uses; *issues.Store satisfies it.
type IssueRepo interface {
	All(ctx context.Context) ([]issues.Issue, error)
	Update(ctx context.Context, is ...issues.Issue) error
	KnownUsers(ctx context.Context) ([]issues.KnownUser, error)
	SyncWatermark(ctx context.Context) (time.Time, error)
	SaveSyncWatermark(ctx context.Context, t time.Time) error
}

var _ IssueRepo = (*issues.Store)(nil)

// Syncer brings ServiceNow's side of each ticket onto its issue. ServiceNow is master for the ticket's
// number, state, assignment and resolution note (research D2); local facts are never overwritten.
type Syncer struct {
	client   *Client
	repo     IssueRepo
	stateMap map[string]string
	now      func() time.Time
}

// NewSyncer builds a Syncer from the client, the issue store and the settings (state map, base URL, table).
func NewSyncer(c *Client, repo IssueRepo, s Settings) *Syncer {
	return &Syncer{client: c, repo: repo, stateMap: s.File.StateMap, now: time.Now}
}

// PullResult reports one poll: the tracked tickets it saw, the issues it wrote and the newest
// `sys_updated_on` among the tickets seen (the next watermark).
type PullResult struct {
	Examined, Changed int
	Watermark         time.Time
}

// Pull is PullOnce from the stored watermark; the watermark moves only after every change is written.
func (s *Syncer) Pull(ctx context.Context) (PullResult, error) {
	since, err := s.repo.SyncWatermark(ctx)
	if err != nil {
		return PullResult{}, err
	}
	res, err := s.PullOnce(ctx, since)
	if err != nil {
		return PullResult{}, err
	}
	if res.Watermark.After(since) {
		if err := s.repo.SaveSyncWatermark(ctx, res.Watermark); err != nil {
			return PullResult{}, err
		}
	}
	return res, nil
}

// PullOnce reads the tickets updated since the watermark (less a one-minute overlap) and updates the issues
// they belong to. Tickets that no tracked issue owns are ignored. A zero since reads every ticket.
func (s *Syncer) PullOnce(ctx context.Context, since time.Time) (PullResult, error) {
	return s.pull(ctx, since, true)
}

// Preview is Pull without writes: what an applied pull would change. The watermark does not move.
func (s *Syncer) Preview(ctx context.Context) (PullResult, error) {
	since, err := s.repo.SyncWatermark(ctx)
	if err != nil {
		return PullResult{}, err
	}
	return s.pull(ctx, since, false)
}

func (s *Syncer) pull(ctx context.Context, since time.Time, apply bool) (PullResult, error) {
	if !since.IsZero() {
		since = since.Add(-watermarkOverlap)
	}
	all, err := s.repo.All(ctx)
	if err != nil {
		return PullResult{}, err
	}
	byCorrelation := map[string]int{}
	for n, i := range all {
		for _, t := range i.Tickets {
			byCorrelation[t.CorrelationID] = n
		}
	}
	if len(byCorrelation) == 0 {
		return PullResult{}, nil
	}
	tickets, err := s.client.ListUpdatedSince(ctx, "", since)
	if err != nil {
		return PullResult{}, err
	}
	users, err := s.repo.KnownUsers(ctx)
	if err != nil {
		return PullResult{}, err
	}

	var res PullResult
	at := formatLocal(s.now())
	next := map[int]issues.Issue{}
	for _, t := range tickets {
		n, ok := byCorrelation[t.CorrelationID]
		if !ok {
			continue
		}
		res.Examined++
		if t.UpdatedOn.After(res.Watermark) {
			res.Watermark = t.UpdatedOn
		}
		i, ok := next[n]
		if !ok {
			i = all[n]
		}
		next[n] = s.apply(i, t, users, at)
	}
	var changed []issues.Issue
	for n, i := range next {
		if !reflect.DeepEqual(i, all[n]) {
			changed = append(changed, i)
		}
	}
	if apply && len(changed) > 0 {
		if err := s.repo.Update(ctx, changed...); err != nil {
			return PullResult{}, err
		}
	}
	res.Changed = len(changed)
	return res, nil
}

// apply merges one ticket into its issue.
func (s *Syncer) apply(i issues.Issue, t Ticket, users []issues.KnownUser, at string) issues.Issue {
	cur, _ := i.CurrentTicket()
	isCurrent := cur.CorrelationID == t.CorrelationID

	tickets := append([]issues.Ticket(nil), i.Tickets...)
	for n := range tickets {
		if tickets[n].CorrelationID != t.CorrelationID {
			continue
		}
		tickets[n].State, tickets[n].StateLabel, tickets[n].ClosedAt = t.State, t.StateLabel, formatLocal(t.ClosedAt)
		if tickets[n].Number == "" {
			tickets[n].Number = t.Number
		}
	}
	out := i
	out.Tickets = tickets
	if isCurrent {
		out = s.applyCurrent(out, t, users)
	}
	if !reflect.DeepEqual(out, i) {
		out.UpdatedBy, out.UpdatedByName, out.UpdatedAt, out.LastSyncedAt = issues.ServiceNowUser, "", at, at
	}
	return out
}

// applyCurrent copies what only the current ticket decides: status, group, assignee, resolution note.
func (s *Syncer) applyCurrent(i issues.Issue, t Ticket, users []issues.KnownUser) issues.Issue {
	if status, ok := s.stateMap[t.State]; !ok {
		log.Printf("servicenow sync: ticket %s has unmapped state %q (%s); the issue status is left as it is", t.Number, t.State, t.StateLabel)
	} else if i.Status != issues.StatusWontFix && i.Status != status {
		// a finding the reconcile re-opened after ServiceNow resolved its ticket waits for a follow-up ticket
		if !(i.FollowUpNeeded && status == issues.StatusResolved) {
			i.Status, i.ResolvedBy = status, ""
			if status == issues.StatusResolved || status == issues.StatusWontFix {
				i.ResolvedBy = issues.ServiceNowUser
			}
		}
	}
	i.ServiceNowGroup = clip(t.AssignmentGroup)
	i.ServiceNowResolution = clip(t.CloseNotes)
	i.ServiceNowAssignee = clip(t.AssignedTo)
	if t.AssignedToUserName != "" || t.AssignedTo != "" {
		i.Assignee, i.AssigneeName = "", ""
		if u, ok := matchUser(users, t.AssignedToUserName); ok {
			i.Assignee, i.AssigneeName = u.Sub, u.DisplayName
			if i.AssigneeName == "" {
				i.AssigneeName = u.Sub
			}
		}
	}
	return i
}

// matchUser finds the known user whose `sub` equals the ServiceNow `user_name`, exactly but ignoring case
// (research Q13). No match never invents a user.
func matchUser(users []issues.KnownUser, userName string) (issues.KnownUser, bool) {
	if userName == "" {
		return issues.KnownUser{}, false
	}
	for _, u := range users {
		if strings.EqualFold(u.Sub, userName) {
			return u, true
		}
	}
	return issues.KnownUser{}, false
}

func clip(s string) string {
	if len(s) <= maxText {
		return s
	}
	r := []rune(s)
	for len(string(r)) > maxText {
		r = r[:len(r)-1]
	}
	return string(r)
}
