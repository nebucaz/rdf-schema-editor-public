package servicenow

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/issues"
)

// Creator is the ServiceNow side of ticket creation: it satisfies issues.TicketCreator with the Table API
// client and the router, so internal/issues never imports this package.
type Creator struct {
	client   *Client
	router   *Router
	baseURL  string
	table    string
	stateMap map[string]string
}

var _ issues.TicketCreator = (*Creator)(nil)

// NewCreator builds a Creator from the client, the router and the settings (state map, base URL, table).
func NewCreator(c *Client, r *Router, s Settings) *Creator {
	table := s.Table
	if table == "" {
		table = "incident"
	}
	return &Creator{client: c, router: r, baseURL: s.BaseURL, table: table, stateMap: s.File.StateMap}
}

// Route derives the ticket routing from the individual the finding is about.
func (c *Creator) Route(ctx context.Context, i issues.Issue) (issues.TicketRouting, error) {
	r, err := c.router.Route(ctx, i.IndividualIri)
	if err != nil {
		return issues.TicketRouting{}, err
	}
	out := issues.TicketRouting{
		AssignmentGroup: r.AssignmentGroup, Contact: r.Contact, Category: r.Category, Impact: r.Impact, Urgency: r.Urgency,
		Blocked: r.Blocked, Warnings: r.Warnings,
	}
	if r.Unrouted != nil {
		out.UnroutedReason = r.Unrouted.Reason
	}
	return out, nil
}

// FindTickets is the idempotency lookup: every ticket whose correlation id starts with findingID.
func (c *Creator) FindTickets(ctx context.Context, findingID string) ([]issues.Ticket, error) {
	found, err := c.client.FindByCorrelation(ctx, findingID)
	if err != nil {
		return nil, err
	}
	out := make([]issues.Ticket, 0, len(found))
	for _, t := range found {
		out = append(out, c.toIssueTicket(t))
	}
	return out, nil
}

// TicketClosed reports whether a state value maps to resolved or wontfix.
func (c *Creator) TicketClosed(state string) bool {
	switch c.stateMap[state] {
	case issues.StatusResolved, issues.StatusWontFix:
		return true
	}
	return false
}

// CreateTicket opens the incident. Only the finding's own facts are sent: the local free-text note is never
// part of a ticket (research D2).
func (c *Creator) CreateTicket(ctx context.Context, req issues.TicketRequest) (issues.Ticket, error) {
	i, rt := req.Issue, req.Routing
	fields := map[string]string{
		"short_description":   shortDescription(i),
		"description":         description(req),
		"correlation_id":      req.CorrelationID,
		"correlation_display": "RDF Schema Editor",
		"category":            rt.Category,
		"impact":              rt.Impact,
		"urgency":             rt.Urgency,
	}
	if rt.AssignmentGroup != "" {
		fields["assignment_group"] = rt.AssignmentGroup
	}
	if rt.Contact != "" {
		fields["caller_id"] = rt.Contact
	}
	t, err := c.client.CreateIncident(ctx, fields)
	if err != nil {
		return issues.Ticket{}, err
	}
	if t.CorrelationID == "" {
		t.CorrelationID = req.CorrelationID
	}
	return c.toIssueTicket(t), nil
}

func (c *Creator) toIssueTicket(t Ticket) issues.Ticket {
	out := issues.Ticket{
		CorrelationID: t.CorrelationID, Number: t.Number, SysID: t.SysID, State: t.State, StateLabel: t.StateLabel,
		CreatedAt: formatLocal(t.CreatedOn), ClosedAt: formatLocal(t.ClosedAt),
	}
	if t.SysID != "" {
		out.URL = c.baseURL + "/nav_to.do?uri=" + url.QueryEscape(c.table+".do?sys_id="+t.SysID)
	}
	return out
}

// formatLocal renders a UTC time the way the issues graph stores one; the zero time is "".
func formatLocal(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func shortDescription(i issues.Issue) string {
	s := issues.TicketHeadline(i)
	if r := []rune(s); len(r) > 160 {
		s = string(r[:160])
	}
	return s
}

func description(req issues.TicketRequest) string {
	i := req.Issue
	var b strings.Builder
	line := func(label, v string) {
		if v != "" {
			fmt.Fprintf(&b, "%s: %s\n", label, v)
		}
	}
	line("Finding", i.Message)
	line("Rule", i.RuleId)
	line("Individual", strings.TrimSpace(i.IndividualLabel+" <"+i.IndividualIri+">"))
	line("Property", i.Path)
	line("Constraint", i.Constraint)
	line("Quality dimension", i.QualityDimension)
	line("Shape", i.ShapeIri)
	if i.Value != nil {
		line("Offending value", *i.Value)
	}
	if req.PreviousNumber != "" {
		line("Follow-up of", req.PreviousNumber+" (the finding returned after that ticket was closed)")
	}
	line("Details", req.DeepLink)
	return strings.TrimRight(b.String(), "\n")
}
