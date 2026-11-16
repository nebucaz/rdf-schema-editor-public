package issues

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// fakeCreator is the ServiceNow side of the create flow.
type fakeCreator struct {
	routing   TicketRouting
	routeErr  error
	found     []Ticket
	findErr   error
	createErr error
	closed    map[string]bool // ServiceNow states that count as closed
	created   []TicketRequest
	finds     int
}

func (f *fakeCreator) Route(context.Context, Issue) (TicketRouting, error) {
	return f.routing, f.routeErr
}
func (f *fakeCreator) FindTickets(context.Context, string) ([]Ticket, error) {
	f.finds++
	return f.found, f.findErr
}
func (f *fakeCreator) CreateTicket(_ context.Context, r TicketRequest) (Ticket, error) {
	f.created = append(f.created, r)
	if f.createErr != nil {
		return Ticket{}, f.createErr
	}
	return Ticket{CorrelationID: r.CorrelationID, Number: "INC000" + string(rune('0'+len(f.created))), SysID: "sys" + r.CorrelationID, State: "1", StateLabel: "New", CreatedAt: "2026-03-01T00:00:00.000Z", URL: "https://sn.example/inc"}, nil
}
func (f *fakeCreator) TicketClosed(state string) bool { return f.closed[state] }

const appURL = "https://rse.example/workbench"

func ticketService(g *fakeGraph, c TicketCreator) *Service {
	svc := NewService(NewStore(g, base), base, "")
	if c != nil {
		svc.EnableTickets(c, TicketOptions{AppURL: appURL, BulkCap: 25})
	}
	return svc
}

func openIssue() map[string]graphdb.Binding {
	return map[string]graphdb.Binding{"id": {Value: validID}, "status": {Value: "open"}, "individualIri": {Value: base + "#app1"}, "ruleId": {Value: "arm-s:7"}, "message": {Value: "owner missing"}}
}

func newCreator() *fakeCreator {
	return &fakeCreator{routing: TicketRouting{AssignmentGroup: "G", Category: "inquiry", Impact: "3", Urgency: "3"}, closed: map[string]bool{"6": true, "7": true, "8": true}}
}

func TestCreateTicketStoresTheTicketAndStampsTheUser(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	c := newCreator()
	got, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "2026-03-01T00:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tickets) != 1 || got.Tickets[0].CorrelationID != validID || got.Tickets[0].Number != "INC0001" || got.Tickets[0].SysID != "sys"+validID {
		t.Errorf("tickets = %+v", got.Tickets)
	}
	if got.ExternalSystem != ExternalSystemServiceNow || got.ExternalID != "INC0001" {
		t.Errorf("external = %q %q", got.ExternalSystem, got.ExternalID)
	}
	if got.SyncState != SyncSynced || got.LastError != "" || got.UpdatedBy != "alice" || got.UpdatedAt != "2026-03-01T00:00:00.000Z" || got.LastSyncedAt != "2026-03-01T00:00:00.000Z" {
		t.Errorf("sync/stamp = %+v", got)
	}
	if len(g.updates) != 1 || !strings.Contains(g.updates[0], "INC0001") {
		t.Errorf("updates = %v", g.updates)
	}
	req := c.created[0]
	if req.CorrelationID != validID || req.PreviousNumber != "" || req.DeepLink != appURL+"/validation?finding="+validID || req.Issue.RuleId != "arm-s:7" {
		t.Errorf("request = %+v", req)
	}
}

func TestCreateTicketIsRefusedWhereTheStoryDemandsIt(t *testing.T) {
	manual := openIssue()
	manual["externalId"], manual["externalSystem"] = graphdb.Binding{Value: "ABC-1"}, graphdb.Binding{Value: "Jira"}
	wontfix := openIssue()
	wontfix["status"] = graphdb.Binding{Value: "wontfix"}
	resolved := openIssue()
	resolved["status"], resolved["resolvedBy"] = graphdb.Binding{Value: "resolved"}, graphdb.Binding{Value: "bob"}
	cases := map[string]map[string]graphdb.Binding{"manual external id": manual, "wontfix": wontfix, "user-resolved": resolved}
	for name, b := range cases {
		g := &fakeGraph{bindings: []map[string]graphdb.Binding{b}}
		c := newCreator()
		_, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t")
		if !IsConflict(err) {
			t.Errorf("%s: err = %v, want conflict", name, err)
		}
		if len(c.created) != 0 || len(g.updates) != 0 {
			t.Errorf("%s: something was written", name)
		}
	}
	if _, err := ticketService(&fakeGraph{bindings: []map[string]graphdb.Binding{manual}}, newCreator()).CreateTicket(context.Background(), validID, alice, "t"); err == nil || !strings.Contains(err.Error(), "clear it first") {
		t.Errorf("manual id message = %v", err)
	}

	// disabled integration, unknown id, bad id
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	if _, err := ticketService(g, nil).CreateTicket(context.Background(), validID, alice, "t"); !IsConflict(err) {
		t.Errorf("disabled err = %v", err)
	}
	g.bindings = nil
	if _, err := ticketService(g, newCreator()).CreateTicket(context.Background(), validID, alice, "t"); !IsNotFound(err) {
		t.Errorf("unknown err = %v", err)
	}
	if _, err := ticketService(g, newCreator()).CreateTicket(context.Background(), "BAD", alice, "t"); !IsInputError(err) {
		t.Errorf("bad id err = %v", err)
	}
}

func TestCreateTicketRefusesWhileTheCurrentTicketIsOpen(t *testing.T) {
	g := &fakeGraph{
		bindings:       []map[string]graphdb.Binding{openIssue()},
		ticketBindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "correlationId": {Value: validID}, "number": {Value: "INC1"}, "state": {Value: "2"}}},
	}
	c := newCreator()
	if _, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t"); !IsConflict(err) {
		t.Errorf("err = %v, want conflict", err)
	}
	if len(c.created) != 0 || c.finds != 0 || len(g.updates) != 0 {
		t.Error("an open ticket must stop the call before ServiceNow and the store")
	}
}

func TestCreateTicketAdoptsTheTicketOfALostResponse(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	c := newCreator()
	c.found = []Ticket{{CorrelationID: validID, Number: "INC9", SysID: "s9", State: "1"}}
	got, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(c.created) != 0 {
		t.Error("a ticket was created although one already exists")
	}
	if len(got.Tickets) != 1 || got.Tickets[0].Number != "INC9" || got.ExternalID != "INC9" || got.SyncState != SyncSynced {
		t.Errorf("issue = %+v", got)
	}
}

func TestCreateTicketOpensAFollowUpAfterAClosedTicket(t *testing.T) {
	g := &fakeGraph{
		bindings:       []map[string]graphdb.Binding{openIssue()},
		ticketBindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "correlationId": {Value: validID}, "number": {Value: "INC1"}, "state": {Value: "6"}}},
	}
	c := newCreator()
	c.found = []Ticket{{CorrelationID: validID, Number: "INC1", State: "6"}}
	got, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(c.created) != 1 || c.created[0].CorrelationID != validID+"-2" || c.created[0].PreviousNumber != "INC1" {
		t.Fatalf("request = %+v", c.created)
	}
	if len(got.Tickets) != 2 || got.Tickets[0].Number != "INC1" || got.ExternalID == "INC1" {
		t.Errorf("history = %+v external %q", got.Tickets, got.ExternalID)
	}
}

func TestCreateTicketHonoursTheRoutingBlock(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	c := newCreator()
	c.routing = TicketRouting{Blocked: true, UnroutedReason: "no authoritative entity"}
	_, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t")
	if !IsConflict(err) || !strings.Contains(err.Error(), "no authoritative entity") {
		t.Errorf("err = %v", err)
	}
	if len(c.created) != 0 {
		t.Error("a blocked finding was ticketed")
	}
}

func TestCreateTicketRecordsAnOutageAndReturnsATicketError(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	c := newCreator()
	c.createErr = errors.New("servicenow: unavailable: status 503")
	_, err := ticketService(g, c).CreateTicket(context.Background(), validID, alice, "t")
	if !IsTicketError(err) || IsConflict(err) || IsInputError(err) {
		t.Fatalf("err = %v", err)
	}
	if len(g.updates) != 1 || !strings.Contains(g.updates[0], `"error"`) || !strings.Contains(g.updates[0], "unavailable") {
		t.Errorf("the error was not recorded: %v", g.updates)
	}
}
