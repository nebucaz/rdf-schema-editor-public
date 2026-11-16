package issues

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// ExternalSystemServiceNow is the ExternalSystem stamped on an issue whose current ticket is a ServiceNow
// incident.
const ExternalSystemServiceNow = "ServiceNow"

// ServiceNowUser stamps changes that come from the ServiceNow sync, beside SystemUser and cookie users.
const ServiceNowUser = "servicenow"

// SyncState values of an issue's ticket sync (research Q9). `none` is an issue without a ticket.
const (
	SyncNone    = "none"
	SyncPending = "pending"
	SyncSynced  = "synced"
	SyncError   = "error"
)

var syncStates = map[string]bool{"": true, SyncNone: true, SyncPending: true, SyncSynced: true, SyncError: true}

// Ticket is one ticket of an issue. An issue holds a history, the latest is the current one (Q6); a
// follow-up ticket is opened when the finding returns after a Resolved/Closed one.
type Ticket struct {
	CorrelationID string `json:"correlationId"` // `<findingId>` or `<findingId>-<n>`
	Number        string `json:"number"`
	SysID         string `json:"sysId"`
	State         string `json:"state"`      // ServiceNow `state` value
	StateLabel    string `json:"stateLabel"` // display text, for people
	CreatedAt     string `json:"createdAt"`
	ClosedAt      string `json:"closedAt"`
	URL           string `json:"url"`
}

// ErrManualExternalID is returned when a ticket would be attached to an issue whose external id was typed
// by hand: such an issue is never ticketed or synced (Q17).
var ErrManualExternalID = errors.New("The issue has a manually entered external id; clear it first")

var correlationPattern = regexp.MustCompile(`^[a-z0-9]{8,64}(-[0-9]{1,6})?$`)

// CorrelationID is the `correlation_id` of the n-th ticket (1-based) of a finding: the finding id for the
// first, `<findingId>-<n>` for follow-ups.
func CorrelationID(findingID string, n int) string {
	if n <= 1 {
		return findingID
	}
	return findingID + "-" + strconv.Itoa(n)
}

// ticketSeq is the 1-based position encoded in a correlation id.
func ticketSeq(correlationID string) int {
	if i := strings.LastIndex(correlationID, "-"); i >= 0 {
		if n, err := strconv.Atoi(correlationID[i+1:]); err == nil && n > 1 {
			return n
		}
	}
	return 1
}

// NextCorrelationID is the correlation id the issue's next ticket gets.
func NextCorrelationID(i Issue) string {
	highest := 0
	for _, t := range i.Tickets {
		highest = max(highest, ticketSeq(t.CorrelationID))
	}
	return CorrelationID(i.ID, highest+1)
}

func sortTickets(ts []Ticket) {
	sort.SliceStable(ts, func(a, b int) bool { return ticketSeq(ts[a].CorrelationID) < ticketSeq(ts[b].CorrelationID) })
}

// CurrentTicket is the latest ticket of the issue.
func (i Issue) CurrentTicket() (Ticket, bool) {
	if len(i.Tickets) == 0 {
		return Ticket{}, false
	}
	cur := i.Tickets[0]
	for _, t := range i.Tickets[1:] {
		if ticketSeq(t.CorrelationID) > ticketSeq(cur.CorrelationID) {
			cur = t
		}
	}
	return cur, true
}

// HasTickets reports whether the issue is linked to ServiceNow, i.e. is subject to the sync.
func (i Issue) HasTickets() bool { return len(i.Tickets) > 0 }

// AddTicket records t on the issue (replacing a ticket with the same correlation id) and mirrors the
// current ticket into ExternalSystem/ExternalID, which stay the API of "the current ticket" so the link and
// the edit modal keep working. A manually entered external id is never overwritten.
func (i *Issue) AddTicket(t Ticket) error {
	if len(i.Tickets) == 0 && i.ExternalID != "" {
		return ErrManualExternalID
	}
	replaced := false
	for n := range i.Tickets {
		if i.Tickets[n].CorrelationID == t.CorrelationID {
			i.Tickets[n], replaced = t, true
		}
	}
	if !replaced {
		i.Tickets = append(i.Tickets, t)
	}
	sortTickets(i.Tickets)
	if cur, ok := i.CurrentTicket(); ok {
		i.ExternalSystem, i.ExternalID = ExternalSystemServiceNow, cur.Number
	}
	return nil
}

// markPending flags a ticketed issue for the next push (Q15): the reconcile only marks, it never calls
// ServiceNow.
func markPending(i Issue) Issue {
	if i.HasTickets() {
		i.SyncState = SyncPending
	}
	return i
}

// TicketRouting is where a ticket goes, as the creator derived it from the finding's identity. Blocked
// says the finding must not be ticketed (unrouted under the `block` policy); UnroutedReason explains both
// that and the fallback case.
type TicketRouting struct {
	AssignmentGroup, Contact, Category, Impact, Urgency string
	UnroutedReason                                      string
	Blocked                                             bool
	Warnings                                            []string
}

// TicketRequest is everything the creator needs to open one ticket. PreviousNumber is the closed ticket a
// follow-up continues; DeepLink points back at the finding.
type TicketRequest struct {
	Issue          Issue
	CorrelationID  string
	PreviousNumber string
	DeepLink       string
	Routing        TicketRouting
}

// TicketCreator is the ServiceNow side of ticket creation. Implemented by the ServiceNow package and wired
// in main.go; this package never imports it.
type TicketCreator interface {
	// Route derives the routing of the issue's finding.
	Route(ctx context.Context, issue Issue) (TicketRouting, error)
	// FindTickets returns every ticket whose correlation id starts with findingID (the idempotency lookup).
	FindTickets(ctx context.Context, findingID string) ([]Ticket, error)
	// CreateTicket opens the ticket and returns it.
	CreateTicket(ctx context.Context, req TicketRequest) (Ticket, error)
	// TicketClosed reports whether a ServiceNow state value is a closed one (Resolved, Closed, Canceled).
	TicketClosed(state string) bool
}

// ErrTicketLocked is returned by a pusher when ServiceNow refuses to write the ticket because it is Closed or
// Canceled; there is nothing to retry.
var ErrTicketLocked = errors.New("The ticket is closed in ServiceNow")

// ErrServiceUnavailable wraps a ServiceNow outage or rate limit: the run stops and the rest waits.
var ErrServiceUnavailable = errors.New("ServiceNow is unavailable")

// TicketPusher pushes the local facts of an issue (finding gone, wontfix, snapshot change) to its current
// ticket. A nil return means pushed or nothing to push; the local free-text note is never part of a push.
type TicketPusher interface {
	PushIssue(ctx context.Context, issue Issue) error
}
