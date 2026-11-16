package servicenow

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

// Pusher sends local facts to an issue's current ticket (research D2/D3): a work note, and for a finding that
// is gone or a won't-fix decision a state change. ServiceNow owns the ticket, so nothing but those facts is
// written, and the local free-text note never leaves the app. Work notes are write-only.
type Pusher struct {
	client        *Client
	stateMap      map[string]string
	closeCode     string
	resolveOnGone bool
}

var _ issues.TicketPusher = (*Pusher)(nil)

// NewPusher builds a Pusher from the client and the settings (state map, close code, finding-gone policy).
func NewPusher(c *Client, s Settings) *Pusher {
	return &Pusher{client: c, stateMap: s.File.StateMap, closeCode: s.File.CloseCode, resolveOnGone: s.OnFindingGone == OnFindingGoneResolve}
}

// stateFor is the ServiceNow state value that maps to status: the lowest number when several do ("6" before
// "7" for resolved); "" when the map has none.
func (p *Pusher) stateFor(status string) string {
	var states []string
	for state, st := range p.stateMap {
		if st == status {
			states = append(states, state)
		}
	}
	sort.Strings(states)
	if len(states) == 0 {
		return ""
	}
	return states[0]
}

func (p *Pusher) closed(state string) bool {
	switch p.stateMap[state] {
	case issues.StatusResolved, issues.StatusWontFix:
		return true
	}
	return false
}

// PushIssue writes the change the issue's local state calls for. Nothing is sent for an issue without a
// ticket, a closed ticket, or a resolution that came from a person or ServiceNow itself.
func (p *Pusher) PushIssue(ctx context.Context, i issues.Issue) error {
	cur, ok := i.CurrentTicket()
	if !ok || cur.SysID == "" || p.closed(cur.State) {
		return nil
	}
	fields := map[string]string{}
	switch {
	case i.Status == issues.StatusWontFix:
		fields["work_notes"] = "Marked won't fix in RDF Schema Editor: the finding is accepted as it is."
		if st := p.stateFor(issues.StatusWontFix); st != "" {
			fields["state"] = st
		}
	case i.Status == issues.StatusResolved && i.ResolvedBy == issues.SystemUser:
		note := "Finding no longer reported by validation run " + i.UpdatedAt + "."
		fields["work_notes"] = note
		if st := p.stateFor(issues.StatusResolved); p.resolveOnGone && st != "" {
			fields["state"], fields["close_code"], fields["close_notes"] = st, p.closeCode, note
		}
	case i.Status == issues.StatusOpen || i.Status == issues.StatusInProgress:
		fields["work_notes"] = snapshotNote(i)
	default:
		return nil
	}
	if _, err := p.client.UpdateIncident(ctx, cur.SysID, fields); err != nil {
		return translate(err)
	}
	return nil
}

func snapshotNote(i issues.Issue) string {
	var b strings.Builder
	b.WriteString("Finding as of the latest validation run: " + i.Message)
	if i.Value != nil {
		b.WriteString(" (offending value: " + *i.Value + ")")
	}
	return b.String()
}

// translate maps a ServiceNow failure onto the errors the issues service acts on: a write to a Closed or
// Canceled ticket is refused with an ACL exception (ErrTicketLocked, nothing to retry), an outage or rate
// limit stops the run.
func translate(err error) error {
	var rej *ErrRejected
	var limited *ErrRateLimited
	switch {
	case errors.As(err, &rej) && strings.Contains(rej.Message, "ACL Exception"):
		return fmt.Errorf("%w: %w", issues.ErrTicketLocked, err)
	case errors.Is(err, ErrUnavailable), errors.As(err, &limited):
		return fmt.Errorf("%w: %w", issues.ErrServiceUnavailable, err)
	}
	return err
}
