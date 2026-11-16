package issues

import (
	"context"
	"errors"
	"strconv"
)

// MaxBulkSelection bounds the issues one bulk request may name or match.
const MaxBulkSelection = 200

// Planned actions of a bulk item, and the result a real run adds.
const (
	TicketActionCreate   = "create"
	TicketActionFollowUp = "follow-up"
	TicketActionSkip     = "skip"
	TicketActionBlocked  = "blocked"

	TicketResultCreated  = "created"
	TicketResultSkipped  = "skipped"
	TicketResultBlocked  = "blocked"
	TicketResultDeferred = "deferred"
	TicketResultError    = "error"
)

// TicketSelection names the issues of a bulk request: explicit ids, or a filter (the fields of Filter);
// not both. An empty selection means every issue, still bounded by MaxBulkSelection.
type TicketSelection struct {
	IDs           []string `json:"ids"`
	Status        string   `json:"status"`
	Assignee      string   `json:"assignee"`
	RuleID        string   `json:"ruleId"`
	IndividualIri string   `json:"individualIri"`
}

// TicketItem is one issue of a bulk dry-run or run. Action is what the plan is; Result is set by a real run
// (and `deferred` already by the dry-run, which shows what the cap cuts off).
type TicketItem struct {
	IssueID         string   `json:"issueId"`
	IndividualLabel string   `json:"individualLabel"`
	RuleID          string   `json:"ruleId"`
	Action          string   `json:"action"`
	Reason          string   `json:"reason,omitempty"`
	Headline        string   `json:"headline,omitempty"`
	AssignmentGroup string   `json:"assignmentGroup,omitempty"`
	Contact         string   `json:"contact,omitempty"`
	Category        string   `json:"category,omitempty"`
	Impact          string   `json:"impact,omitempty"`
	Urgency         string   `json:"urgency,omitempty"`
	Unrouted        string   `json:"unrouted,omitempty"` // why the identity gave no authoritative entity
	Warnings        []string `json:"warnings,omitempty"`
	Result          string   `json:"result,omitempty"`
	Number          string   `json:"number,omitempty"`
	Error           string   `json:"error,omitempty"`
}

// TicketRun is the answer of a dry-run or a real bulk run.
type TicketRun struct {
	DryRun bool         `json:"dryRun"`
	Cap    int          `json:"cap"`
	Items  []TicketItem `json:"items"`
}

// planned is one selected issue with what the run needs to act on it.
type planned struct {
	item    TicketItem
	issue   Issue
	plan    ticketPlan
	routing TicketRouting
	doable  bool // a create or follow-up that the cap did not cut off
}

func (s *Service) selectIssues(ctx context.Context, sel TicketSelection) ([]Issue, []string, error) {
	f := Filter{Status: sel.Status, Assignee: sel.Assignee, RuleID: sel.RuleID, IndividualIri: sel.IndividualIri}
	if len(sel.IDs) > 0 {
		if f != (Filter{}) {
			return nil, nil, inputErrorf("Select by ids or by a filter, not both")
		}
		if len(sel.IDs) > MaxBulkSelection {
			return nil, nil, inputErrorf("Too many issues selected (%d, at most %d)", len(sel.IDs), MaxBulkSelection)
		}
		seen := map[string]bool{}
		var found []Issue
		var missing []string
		for _, id := range sel.IDs {
			if !ValidID(id) {
				return nil, nil, inputErrorf("Invalid issue id")
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			i, ok, err := s.store.Get(ctx, id)
			if err != nil {
				return nil, nil, err
			}
			if !ok {
				missing = append(missing, id)
				continue
			}
			found = append(found, i)
		}
		return found, missing, nil
	}
	n, err := s.store.Count(ctx, f)
	if err != nil {
		return nil, nil, err
	}
	if n > MaxBulkSelection {
		return nil, nil, inputErrorf("The filter matches %d issues, at most %d per request; narrow it", n, MaxBulkSelection)
	}
	f.Limit = MaxBulkSelection
	found, err := s.store.List(ctx, f)
	return found, nil, err
}

// planAll decides the action of every selected issue, then applies the per-run cap to the doable ones.
func (s *Service) planAll(ctx context.Context, sel TicketSelection) ([]*planned, error) {
	if s.tickets == nil {
		return nil, conflictf("The ServiceNow integration is not enabled")
	}
	found, missing, err := s.selectIssues(ctx, sel)
	if err != nil {
		return nil, err
	}
	var out []*planned
	for _, id := range missing {
		out = append(out, &planned{item: TicketItem{IssueID: id, Action: TicketActionSkip, Reason: ErrNotFound.Error()}})
	}
	doable := 0
	for _, i := range found {
		p := &planned{issue: i, item: TicketItem{IssueID: i.ID, IndividualLabel: i.IndividualLabel, RuleID: i.RuleId}}
		out = append(out, p)
		plan, err := s.planTicket(i)
		if err != nil {
			p.item.Action, p.item.Reason = TicketActionSkip, err.Error()
			continue
		}
		p.plan = plan
		routing, err := s.tickets.Route(ctx, i)
		if err != nil {
			p.item.Action, p.item.Reason = TicketActionBlocked, "Routing failed: "+err.Error()
			continue
		}
		p.routing = routing
		it := &p.item
		it.AssignmentGroup, it.Contact, it.Category, it.Impact, it.Urgency = routing.AssignmentGroup, routing.Contact, routing.Category, routing.Impact, routing.Urgency
		it.Unrouted, it.Warnings = routing.UnroutedReason, routing.Warnings
		if routing.Blocked {
			it.Action, it.Reason = TicketActionBlocked, "Cannot be routed: "+routing.UnroutedReason
			continue
		}
		it.Action, it.Headline = TicketActionCreate, TicketHeadline(i)
		if plan.followUp {
			it.Action = TicketActionFollowUp
		}
		if doable >= s.ticketOpts.BulkCap {
			it.Result, it.Reason = TicketResultDeferred, "Over the per-run cap of "+strconv.Itoa(s.ticketOpts.BulkCap)
			continue
		}
		doable++
		p.doable = true
	}
	return out, nil
}

func (s *Service) runOf(ps []*planned, dry bool) TicketRun {
	run := TicketRun{DryRun: dry, Cap: s.ticketOpts.BulkCap, Items: make([]TicketItem, 0, len(ps))}
	for _, p := range ps {
		run.Items = append(run.Items, p.item)
	}
	return run
}

// PlanTickets is the dry-run: what a run would do for the selection, per issue. It changes nothing, locally
// or in ServiceNow.
func (s *Service) PlanTickets(ctx context.Context, sel TicketSelection) (TicketRun, error) {
	ps, err := s.planAll(ctx, sel)
	if err != nil {
		return TicketRun{}, err
	}
	return s.runOf(ps, true), nil
}

// CreateTickets plans like PlanTickets and then creates the doable tickets one at a time through the
// single-ticket path. A failing issue does not stop the run; a spent rate-limit budget defers the rest.
func (s *Service) CreateTickets(ctx context.Context, sel TicketSelection, by Actor, at string) (TicketRun, error) {
	ps, err := s.planAll(ctx, sel)
	if err != nil {
		return TicketRun{}, err
	}
	pace := &pacer{remaining: s.rateBudget, sleep: s.sleep}
	spent := false
	for _, p := range ps {
		it := &p.item
		switch {
		case it.Action == TicketActionSkip:
			it.Result = TicketResultSkipped
		case it.Action == TicketActionBlocked:
			it.Result = TicketResultBlocked
		case !p.doable:
			// deferred by the cap, already labelled
		case spent:
			it.Result, it.Reason = TicketResultDeferred, errRateBudget.Error()
		default:
			got, err := s.openTicket(ctx, p.issue, p.plan, p.routing, by, at, pace)
			switch {
			case errors.Is(err, errRateBudget):
				spent = true
				it.Result, it.Reason = TicketResultDeferred, errRateBudget.Error()
			case err != nil:
				it.Result, it.Error = TicketResultError, err.Error()
			default:
				it.Result = TicketResultCreated
				if cur, ok := got.CurrentTicket(); ok {
					it.Number = cur.Number
				}
			}
		}
	}
	return s.runOf(ps, false), nil
}
