package issues

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

func TestReconcileReopensAServiceNowResolvedIssueAndFlagsAFollowUp(t *testing.T) {
	i := sample()
	i.Status, i.ResolvedBy = StatusResolved, ServiceNowUser
	_ = i.AddTicket(Ticket{CorrelationID: i.ID, Number: "INC1", State: "6"})
	i.ID = "aaaaaaaaaaaaaaaa"
	i.Tickets[0].CorrelationID = i.ID
	repo := newMemRepo(i)
	if _, err := Reconcile(context.Background(), repo, []validation.Violation{viol(i.ID)}, nil, "u", "U", t2); err != nil {
		t.Fatal(err)
	}
	got := repo.byID[i.ID]
	if got.Status != StatusOpen || got.ResolvedBy != "" || !got.FollowUpNeeded || got.SyncState != SyncPending {
		t.Errorf("issue = %+v", got)
	}
}

func TestReconcileDoesNotFlagAFollowUpForASystemResolvedIssue(t *testing.T) {
	i := sample()
	i.Status, i.ResolvedBy = StatusResolved, SystemUser
	repo := newMemRepo(i)
	if _, err := Reconcile(context.Background(), repo, []validation.Violation{viol(i.ID)}, nil, "u", "U", t2); err != nil {
		t.Fatal(err)
	}
	if got := repo.byID[i.ID]; got.Status != StatusOpen || got.FollowUpNeeded {
		t.Errorf("issue = %+v", got)
	}
}

func TestStoreKeepsTheSyncFieldsAndTheWatermark(t *testing.T) {
	g := &fakeGraph{}
	s := NewStore(g, base)
	i := sample()
	i.ServiceNowResolution, i.FollowUpNeeded = "fixed", true
	if err := s.Create(context.Background(), i); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`#serviceNowResolution> "fixed"`, `#followUpNeeded> "true"`} {
		if !strings.Contains(g.updates[0], want) {
			t.Errorf("update lacks %q:\n%s", want, g.updates[0])
		}
	}
	g.bindings = []map[string]graphdb.Binding{{"id": {Value: validID}, "status": {Value: "open"}, "serviceNowResolution": {Value: "fixed"}, "followUpNeeded": {Value: "true"}}}
	got, ok, err := s.Get(context.Background(), validID)
	if err != nil || !ok || got.ServiceNowResolution != "fixed" || !got.FollowUpNeeded {
		t.Errorf("get = %+v %v %v", got, ok, err)
	}

	at := time.Date(2026, 3, 1, 10, 0, 5, 0, time.UTC)
	if err := s.SaveSyncWatermark(context.Background(), at); err != nil {
		t.Fatal(err)
	}
	u := g.updates[len(g.updates)-1]
	if !strings.Contains(u, "#ticketSync>") || !strings.Contains(u, `"2026-03-01T10:00:05.000Z"`) || strings.Contains(u, "#lastRun>") {
		t.Errorf("watermark update:\n%s", u)
	}
	g.bindings = []map[string]graphdb.Binding{{"at": {Value: "2026-03-01T10:00:05.000Z"}}}
	mark, err := s.SyncWatermark(context.Background())
	if err != nil || !mark.Equal(at) {
		t.Errorf("watermark = %v %v", mark, err)
	}
	g.bindings = nil
	if mark, _ := s.SyncWatermark(context.Background()); !mark.IsZero() {
		t.Errorf("empty watermark = %v", mark)
	}
}

func TestPatchRefusesAssigneeChangesWhileTheTicketIsOpen(t *testing.T) {
	open := openIssue()
	open["assignee"] = graphdb.Binding{Value: "bob"}
	g := &fakeGraph{
		bindings:       []map[string]graphdb.Binding{open},
		ticketBindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "correlationId": {Value: validID}, "number": {Value: "INC1"}, "state": {Value: "2"}}},
	}
	svc := ticketService(g, newCreator())
	carol := "carol"
	if _, err := svc.Patch(context.Background(), validID, Patch{Assignee: &carol}, alice, "t"); !IsConflict(err) {
		t.Fatalf("err = %v, want a conflict", err)
	}
	same := "bob"
	if _, err := svc.Patch(context.Background(), validID, Patch{Assignee: &same}, alice, "t"); err != nil {
		t.Errorf("an unchanged assignee must pass: %v", err)
	}
	// a closed ticket frees the assignee again
	g.ticketBindings[0]["state"] = graphdb.Binding{Value: "6"}
	if _, err := svc.Patch(context.Background(), validID, Patch{Assignee: &carol}, alice, "t"); err != nil {
		t.Errorf("closed ticket: %v", err)
	}
}
