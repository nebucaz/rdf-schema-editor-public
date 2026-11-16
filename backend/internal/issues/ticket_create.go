package issues

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TicketOptions configures ticket creation. AppURL is the public URL of this app (with its base path), used
// for the deep link in a ticket; BulkCap is the per-run limit of a bulk creation.
type TicketOptions struct {
	AppURL  string
	BulkCap int
	// NoAutoPush keeps reconcile and local decisions from queuing pushes (SERVICENOW_SYNC_ENABLED=false);
	// an explicit PushPending still sends what is already queued.
	NoAutoPush bool
}

// EnableTickets switches ticket creation on. Without it every ticket call is refused.
func (s *Service) EnableTickets(c TicketCreator, o TicketOptions) {
	s.tickets, s.ticketOpts = c, o
}

type conflictError struct{ msg string }

func (e conflictError) Error() string { return e.msg }

func conflictf(format string, a ...any) error { return conflictError{fmt.Sprintf(format, a...)} }

// IsConflict reports whether err means the issue is not in a state that allows the call (HTTP 409).
func IsConflict(err error) bool {
	var ce conflictError
	return errors.As(err, &ce)
}

// TicketError is a failure of ServiceNow itself (HTTP 502); the issue's SyncState and LastError record it.
type TicketError struct{ Err error }

func (e *TicketError) Error() string { return "ServiceNow: " + e.Err.Error() }
func (e *TicketError) Unwrap() error { return e.Err }

// IsTicketError reports whether err is a ServiceNow failure.
func IsTicketError(err error) bool {
	var te *TicketError
	return errors.As(err, &te)
}

// ticketPlan is what a create would do for one issue; err is the reason it must not.
type ticketPlan struct {
	correlationID  string
	previousNumber string
	followUp       bool
}

// planTicket decides, from the issue alone, whether a ticket may be created and under which correlation id.
// A refusal is a conflict error whose text is shown to the user.
func (s *Service) planTicket(i Issue) (ticketPlan, error) {
	switch i.Status {
	case StatusWontFix:
		return ticketPlan{}, conflictf("The issue is marked won't fix; no ticket is created")
	case StatusResolved:
		return ticketPlan{}, conflictf("The issue is resolved; no ticket is created")
	}
	if !i.HasTickets() && i.ExternalID != "" {
		return ticketPlan{}, conflictf("%s", ErrManualExternalID.Error())
	}
	plan := ticketPlan{correlationID: NextCorrelationID(i)}
	if cur, ok := i.CurrentTicket(); ok {
		if !s.tickets.TicketClosed(cur.State) {
			return ticketPlan{}, conflictf("The issue already has an open ticket (%s)", cur.Number)
		}
		plan.followUp, plan.previousNumber = true, cur.Number
	}
	return plan, nil
}

func (s *Service) deepLink(id string) string {
	if s.ticketOpts.AppURL == "" {
		return ""
	}
	return strings.TrimRight(s.ticketOpts.AppURL, "/") + "/validation?finding=" + url.QueryEscape(id)
}

// CreateTicket opens a ServiceNow ticket for one issue: idempotent (a ticket of a lost response is adopted),
// follow-up aware (a closed ticket is continued by `<findingId>-<n>`), and stamped with the acting user.
func (s *Service) CreateTicket(ctx context.Context, id string, by Actor, at string) (Issue, error) {
	if s.tickets == nil {
		return Issue{}, conflictf("The ServiceNow integration is not enabled")
	}
	i, ok, err := s.store.Get(ctx, id)
	if err != nil {
		return Issue{}, err
	}
	if !ok {
		return Issue{}, ErrNotFound
	}
	plan, err := s.planTicket(i)
	if err != nil {
		return Issue{}, err
	}
	routing, err := s.tickets.Route(ctx, i)
	if err != nil {
		return Issue{}, err
	}
	if routing.Blocked {
		return Issue{}, conflictf("The finding cannot be routed: %s", routing.UnroutedReason)
	}
	return s.openTicket(ctx, i, plan, routing, by, at, nil)
}

// errRateBudget means the rate-limit pause budget of a bulk run is spent; the issue is deferred, not failed.
var errRateBudget = errors.New("ServiceNow rate limit: the pause budget of this run is spent, retry later")

// openTicket adopts or creates the ticket and stores the result. A ServiceNow failure is recorded on the
// issue (SyncState=error, LastError) before it is returned. With a pacer (a bulk run) a rate-limit answer
// pauses and retries instead.
func (s *Service) openTicket(ctx context.Context, i Issue, plan ticketPlan, routing TicketRouting, by Actor, at string, pace *pacer) (Issue, error) {
	var ticket Ticket
	var err error
	for {
		ticket, err = s.adoptOrCreate(ctx, i, plan, routing)
		if err == nil || pace == nil {
			break
		}
		d, limited := rateLimitDelay(err)
		if !limited {
			break
		}
		if !pace.wait(ctx, d) {
			return Issue{}, &TicketError{Err: errRateBudget}
		}
	}
	if err != nil {
		i.SyncState, i.LastError = SyncError, err.Error()
		i.UpdatedBy, i.UpdatedByName, i.UpdatedAt = by.Sub, by.DisplayName, at
		if len(i.LastError) > maxSnapshot {
			i.LastError = i.LastError[:maxSnapshot]
		}
		if uerr := s.store.Update(ctx, i); uerr != nil {
			return Issue{}, uerr
		}
		return Issue{}, &TicketError{Err: err}
	}
	if err := i.AddTicket(ticket); err != nil {
		return Issue{}, conflictf("%s", err.Error())
	}
	i.SyncState, i.LastError, i.LastSyncedAt, i.FollowUpNeeded = SyncSynced, "", at, false
	i.UpdatedBy, i.UpdatedByName, i.UpdatedAt = by.Sub, by.DisplayName, at
	if err := s.store.Update(ctx, i); err != nil {
		return Issue{}, err
	}
	return s.decorate(i), nil
}

// rateLimitDelay reports whether err is a ServiceNow rate limit and how long the instance asked to wait.
func rateLimitDelay(err error) (time.Duration, bool) {
	var r interface{ RetryDelay() time.Duration }
	if errors.As(err, &r) {
		return r.RetryDelay(), true
	}
	return 0, false
}

// pacer spends the pause budget of one bulk run on rate-limit answers.
type pacer struct {
	remaining time.Duration
	sleep     func(context.Context, time.Duration) error
}

// defaultRateWait is used when the instance sends 429 without a Retry-After.
const defaultRateWait = time.Second

// wait pauses for d (or the default) and reports whether the run may retry; false once the budget is spent.
func (p *pacer) wait(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		d = defaultRateWait
	}
	if d > p.remaining {
		p.remaining = 0
		return false
	}
	p.remaining -= d
	return p.sleep(ctx, d) == nil
}

// TicketHeadline is the one-line title of a finding's ticket: the rule and the individual.
func TicketHeadline(i Issue) string {
	who := i.IndividualLabel
	if who == "" {
		who = i.IndividualIri
	}
	return "[" + i.RuleId + "] " + who
}

func (s *Service) adoptOrCreate(ctx context.Context, i Issue, plan ticketPlan, routing TicketRouting) (Ticket, error) {
	existing, err := s.tickets.FindTickets(ctx, i.ID)
	if err != nil {
		return Ticket{}, err
	}
	corr := plan.correlationID
	for {
		var hit *Ticket
		for n := range existing {
			if existing[n].CorrelationID == corr {
				hit = &existing[n]
			}
		}
		if hit == nil {
			break
		}
		if !s.tickets.TicketClosed(hit.State) {
			return *hit, nil // the response of an earlier create was lost
		}
		plan.previousNumber = hit.Number
		corr = CorrelationID(i.ID, ticketSeq(corr)+1)
	}
	return s.tickets.CreateTicket(ctx, TicketRequest{
		Issue: i, CorrelationID: corr, PreviousNumber: plan.previousNumber, DeepLink: s.deepLink(i.ID), Routing: routing,
	})
}
