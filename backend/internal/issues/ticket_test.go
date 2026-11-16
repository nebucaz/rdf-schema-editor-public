package issues

import (
	"context"
	"encoding/json"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

func TestCorrelationIDsCountFollowUps(t *testing.T) {
	if got := CorrelationID(validID, 1); got != validID {
		t.Errorf("first = %q", got)
	}
	if got := CorrelationID(validID, 2); got != validID+"-2" {
		t.Errorf("second = %q", got)
	}
	if got := CorrelationID(validID, 3); got != validID+"-3" {
		t.Errorf("third = %q", got)
	}
	i := Issue{ID: validID}
	if got := NextCorrelationID(i); got != validID {
		t.Errorf("no tickets: %q", got)
	}
	i.Tickets = []Ticket{{CorrelationID: validID}}
	if got := NextCorrelationID(i); got != validID+"-2" {
		t.Errorf("one ticket: %q", got)
	}
	i.Tickets = []Ticket{{CorrelationID: validID + "-2"}, {CorrelationID: validID}}
	if got := NextCorrelationID(i); got != validID+"-3" {
		t.Errorf("two tickets, any order: %q", got)
	}
}

func TestTheCurrentTicketIsTheLatest(t *testing.T) {
	i := Issue{ID: validID, Tickets: []Ticket{{CorrelationID: validID + "-2", Number: "INC2"}, {CorrelationID: validID, Number: "INC1"}}}
	cur, ok := i.CurrentTicket()
	if !ok || cur.Number != "INC2" {
		t.Errorf("current = %+v", cur)
	}
	if _, ok := (Issue{}).CurrentTicket(); ok {
		t.Error("no tickets, no current")
	}
}

func TestAddTicketMirrorsTheExternalFieldsAndKeepsManualIDs(t *testing.T) {
	i := sample()
	if err := i.AddTicket(Ticket{CorrelationID: validID, Number: "INC0010001", SysID: "s1"}); err != nil {
		t.Fatal(err)
	}
	if i.ExternalSystem != ExternalSystemServiceNow || i.ExternalID != "INC0010001" || len(i.Tickets) != 1 {
		t.Errorf("issue = %+v", i)
	}
	if err := i.AddTicket(Ticket{CorrelationID: validID + "-2", Number: "INC0010002"}); err != nil {
		t.Fatal(err)
	}
	if i.ExternalID != "INC0010002" || len(i.Tickets) != 2 {
		t.Errorf("follow-up not mirrored: %+v", i)
	}

	manual := sample()
	manual.ExternalSystem, manual.ExternalID = "Jira", "ABC-1"
	if err := manual.AddTicket(Ticket{CorrelationID: validID, Number: "INC1"}); err != ErrManualExternalID {
		t.Errorf("err = %v, want ErrManualExternalID", err)
	}
	if manual.ExternalID != "ABC-1" || len(manual.Tickets) != 0 {
		t.Errorf("manual issue was touched: %+v", manual)
	}
}

func TestTicketsAndSyncStateAreWrittenToTheIssuesGraph(t *testing.T) {
	g := &fakeGraph{}
	i := sample()
	i.Tickets = []Ticket{
		{CorrelationID: validID, Number: "INC1", SysID: "s1", State: "6", StateLabel: "Resolved", CreatedAt: "2026-01-02T00:00:00.000Z", ClosedAt: "2026-01-03T00:00:00.000Z", URL: "https://x/inc1"},
		{CorrelationID: validID + "-2", Number: "INC2", SysID: "s2", State: "1", StateLabel: "New", CreatedAt: "2026-01-04T00:00:00.000Z"},
	}
	i.ServiceNowAssignee, i.ServiceNowGroup = "Dev User", "Finance Apps"
	i.SyncState, i.LastSyncedAt, i.LastError = SyncError, "2026-01-05T00:00:00.000Z", "unavailable"
	if err := NewStore(g, base).Update(context.Background(), i); err != nil {
		t.Fatal(err)
	}
	u := g.updates[0]
	for _, want := range []string{
		"#Ticket>", "<" + base + "/issues#ticket-" + validID + "-2>", `"INC2"`, `"s2"`, `"Resolved"`,
		`"Dev User"`, `"Finance Apps"`, `"error"`, `"unavailable"`, "#ticketOf>", "#syncState>", "#lastSyncedAt>",
	} {
		if !strings.Contains(u, want) {
			t.Errorf("update lacks %q:\n%s", want, u)
		}
	}
	if !strings.Contains(u, "DELETE") || !strings.Contains(u, "#ticketOf> <"+base+"/issues#"+validID+">") {
		t.Errorf("old ticket nodes are not replaced:\n%s", u)
	}
	if strings.Contains(u, "/schema>") || strings.Contains(u, "/shapes>") {
		t.Error("tickets must stay in the issues graph")
	}
}

func TestTicketsAreReadBackInOrderAndLegacyIssuesLoadUnchanged(t *testing.T) {
	g := &fakeGraph{
		bindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "status": {Value: "open"}, "syncState": {Value: "synced"}, "serviceNowAssignee": {Value: "Dev User"}, "serviceNowGroup": {Value: "G"}, "lastSyncedAt": {Value: "t"}, "lastError": {Value: "e"}}},
		ticketBindings: []map[string]graphdb.Binding{
			{"id": {Value: validID}, "correlationId": {Value: validID + "-2"}, "number": {Value: "INC2"}, "sysId": {Value: "s2"}, "state": {Value: "2"}, "stateLabel": {Value: "In Progress"}, "createdAt": {Value: "c2"}, "url": {Value: "u2"}},
			{"id": {Value: validID}, "correlationId": {Value: validID}, "number": {Value: "INC1"}, "closedAt": {Value: "x"}},
		},
	}
	got, ok, err := NewStore(g, base).Get(context.Background(), validID)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if len(got.Tickets) != 2 || got.Tickets[0].Number != "INC1" || got.Tickets[1].Number != "INC2" || got.Tickets[1].StateLabel != "In Progress" || got.Tickets[0].ClosedAt != "x" {
		t.Errorf("tickets = %+v", got.Tickets)
	}
	if got.SyncState != SyncSynced || got.ServiceNowAssignee != "Dev User" || got.ServiceNowGroup != "G" || got.LastSyncedAt != "t" || got.LastError != "e" {
		t.Errorf("sync fields = %+v", got)
	}

	// a v1.7 issue: no ticket nodes, no sync fields
	g.ticketBindings = nil
	g.bindings = []map[string]graphdb.Binding{{"id": {Value: validID}, "status": {Value: "open"}, "externalId": {Value: "ABC-1"}, "externalSystem": {Value: "Jira"}}}
	got, _, _ = NewStore(g, base).Get(context.Background(), validID)
	if got.SyncState != SyncNone || got.Tickets == nil || len(got.Tickets) != 0 || got.ExternalID != "ABC-1" {
		t.Errorf("legacy issue = %+v", got)
	}
}

func TestListLoadsTicketsForThePageOnly(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{"id": {Value: validID}}}}
	if _, err := NewStore(g, base).List(context.Background(), Filter{}); err != nil {
		t.Fatal(err)
	}
	if len(g.queries) != 2 || !strings.Contains(g.queries[1], "<"+base+"/issues#"+validID+">") {
		t.Errorf("queries = %v", g.queries)
	}
	g2 := &fakeGraph{}
	_, _ = NewStore(g2, base).List(context.Background(), Filter{})
	if len(g2.queries) != 1 {
		t.Errorf("an empty page must not query tickets: %v", g2.queries)
	}
}

func TestServiceNowIsAValidActorAndResolver(t *testing.T) {
	i := sample()
	i.Status, i.ResolvedBy, i.UpdatedBy = StatusResolved, ServiceNowUser, ServiceNowUser
	if err := Validate(i); err != nil {
		t.Errorf("servicenow resolver refused: %v", err)
	}
	i.SyncState = "bogus"
	if err := Validate(i); !IsInputError(err) {
		t.Errorf("bad sync state err = %v", err)
	}
	i.SyncState = SyncPending
	i.Tickets = []Ticket{{CorrelationID: "a>b"}}
	if err := Validate(i); !IsInputError(err) {
		t.Errorf("unsafe correlation id err = %v", err)
	}
}

func TestIssueJSONIsAdditive(t *testing.T) {
	raw, _ := json.Marshal(sample())
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	for _, k := range []string{"id", "individualIri", "status", "resolvedBy", "assignee", "externalSystem", "externalId", "externalUrl", "lastSeenAt",
		"tickets", "serviceNowAssignee", "serviceNowGroup", "syncState", "lastSyncedAt", "lastError"} {
		if _, ok := m[k]; !ok {
			t.Errorf("JSON lacks %q", k)
		}
	}
}

// internal/issues owns the interfaces it needs and never imports internal/servicenow (research Q15).
func TestIssuesDoesNotImportServiceNow(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	for _, f := range files {
		file, err := parser.ParseFile(fset, f, nil, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range file.Imports {
			if strings.Contains(imp.Path.Value, "internal/servicenow") {
				t.Errorf("%s imports %s", f, imp.Path.Value)
			}
		}
	}
}

func TestReconcileOnlyMarksTicketedIssuesPending(t *testing.T) {
	ticketed := sample()
	ticketed.ID = "aaaaaaaaaaaaaaaa"
	ticketed.Tickets = []Ticket{{CorrelationID: ticketed.ID, Number: "INC1"}}
	ticketed.ExternalSystem, ticketed.ExternalID, ticketed.SyncState = ExternalSystemServiceNow, "INC1", SyncSynced
	plain := sample()
	plain.ID = "bbbbbbbbbbbbbbbb"
	manual := sample()
	manual.ID = "cccccccccccccccc"
	manual.ExternalSystem, manual.ExternalID = "Jira", "ABC-1"
	repo := newMemRepo(ticketed, plain, manual)

	// nothing in the run: all three findings are gone, so all three resolve by the system
	run(t, repo, nil, nil, t1)
	if got := repo.byID[ticketed.ID]; got.SyncState != SyncPending || got.Status != StatusResolved {
		t.Errorf("ticketed = %+v", got)
	}
	for _, id := range []string{plain.ID, manual.ID} {
		if got := repo.byID[id]; got.SyncState == SyncPending || got.Status != StatusResolved {
			t.Errorf("%s = state %q status %q, want no sync state", id, got.SyncState, got.Status)
		}
	}

	// the finding returns: re-opened and pending again; an unchanged finding stays synced
	repo.byID[ticketed.ID] = withSync(repo.byID[ticketed.ID], SyncSynced)
	run(t, repo, []validation.Violation{viol(ticketed.ID)}, nil, t2)
	if got := repo.byID[ticketed.ID]; got.Status != StatusOpen || got.SyncState != SyncPending {
		t.Errorf("returned = %+v", got)
	}
	repo.byID[ticketed.ID] = withSync(repo.byID[ticketed.ID], SyncSynced)
	run(t, repo, []validation.Violation{viol(ticketed.ID)}, nil, "2026-02-03T00:00:00.000Z")
	if got := repo.byID[ticketed.ID]; got.SyncState != SyncSynced {
		t.Errorf("unchanged finding must stay synced: %+v", got)
	}
}

func withSync(i Issue, s string) Issue { i.SyncState = s; return i }
