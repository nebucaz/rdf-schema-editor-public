package issues

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

type fakePusher struct {
	pushed []Issue
	err    error
}

func (f *fakePusher) PushIssue(_ context.Context, i Issue) error {
	f.pushed = append(f.pushed, i)
	return f.err
}

func pendingGraph(state string, sync string) *fakeGraph {
	b := openIssue()
	b["syncState"] = graphdb.Binding{Value: sync}
	b["lastError"] = graphdb.Binding{Value: "old error"}
	return &fakeGraph{
		bindings:       []map[string]graphdb.Binding{b},
		ticketBindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "correlationId": {Value: validID}, "number": {Value: "INC1"}, "sysId": {Value: "s1"}, "state": {Value: state}}},
	}
}

func pushService(g *fakeGraph, p TicketPusher) *Service {
	svc := ticketService(g, newCreator())
	svc.EnablePush(p)
	return svc
}

func TestPushPendingMarksASuccessfulPushSynced(t *testing.T) {
	g := pendingGraph("2", SyncPending)
	p := &fakePusher{}
	res, err := pushService(g, p).PushPending(context.Background(), "2026-03-02T00:00:00.000Z")
	if err != nil || res.Pushed != 1 || res.Failed != 0 {
		t.Fatalf("res = %+v err %v", res, err)
	}
	if len(p.pushed) != 1 || len(g.updates) != 1 {
		t.Fatalf("pushed %d, updates %d", len(p.pushed), len(g.updates))
	}
	u := g.updates[0]
	if !strings.Contains(u, `#syncState> "synced"`) || !strings.Contains(u, "2026-03-02T00:00:00.000Z") || strings.Contains(u, "old error") {
		t.Errorf("update:\n%s", u)
	}
}

func TestPushPendingRecordsAFailureAndRetriesIt(t *testing.T) {
	g := pendingGraph("2", SyncPending)
	p := &fakePusher{err: errors.New("boom")}
	svc := pushService(g, p)
	res, err := svc.PushPending(context.Background(), "t")
	if err != nil || res.Failed != 1 || res.Pushed != 0 {
		t.Fatalf("res = %+v err %v", res, err)
	}
	if u := g.updates[0]; !strings.Contains(u, `#syncState> "error"`) || !strings.Contains(u, `#lastError> "boom"`) {
		t.Errorf("update:\n%s", u)
	}
	// the stored state is now `error`: the next run picks it up again
	g2 := pendingGraph("2", SyncError)
	p2 := &fakePusher{}
	if res, _ := pushService(g2, p2).PushPending(context.Background(), "t"); res.Pushed != 1 {
		t.Errorf("retry res = %+v", res)
	}
}

func TestPushPendingTreatsALockedTicketAsDoneAndSkipsClosedOnes(t *testing.T) {
	g := pendingGraph("2", SyncPending)
	res, err := pushService(g, &fakePusher{err: fmt.Errorf("x: %w", ErrTicketLocked)}).PushPending(context.Background(), "t")
	if err != nil || res.Failed != 0 || res.Skipped != 1 {
		t.Fatalf("res = %+v err %v", res, err)
	}
	if u := g.updates[0]; !strings.Contains(u, `#syncState> "synced"`) || strings.Contains(u, "#lastError>") {
		t.Errorf("update:\n%s", u)
	}

	closed := pendingGraph("6", SyncPending) // newCreator treats 6 as closed
	p := &fakePusher{}
	res, _ = pushService(closed, p).PushPending(context.Background(), "t")
	if len(p.pushed) != 0 || res.Skipped != 1 || !strings.Contains(closed.updates[0], `#syncState> "synced"`) {
		t.Errorf("closed: pushed %d res %+v updates %v", len(p.pushed), res, closed.updates)
	}
}

func TestPushPendingLeavesSyncedAndTicketlessIssuesAlone(t *testing.T) {
	g := pendingGraph("2", SyncSynced)
	p := &fakePusher{}
	res, err := pushService(g, p).PushPending(context.Background(), "t")
	if err != nil || len(p.pushed) != 0 || len(g.updates) != 0 || res.Pushed != 0 {
		t.Errorf("synced: res %+v err %v pushed %d updates %d", res, err, len(p.pushed), len(g.updates))
	}
	none := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	if _, err := pushService(none, p).PushPending(context.Background(), "t"); err != nil || len(p.pushed) != 0 {
		t.Errorf("ticketless: %v pushed %d", err, len(p.pushed))
	}
}

func TestPushPendingStopsWhenServiceNowIsUnavailable(t *testing.T) {
	g := pendingGraph("2", SyncPending)
	second := openIssue()
	second["id"] = graphdb.Binding{Value: "bbbbbbbbbbbbbbbb"}
	second["syncState"] = graphdb.Binding{Value: SyncPending}
	g.bindings = append(g.bindings, second)
	g.ticketBindings = append(g.ticketBindings, map[string]graphdb.Binding{"id": {Value: "bbbbbbbbbbbbbbbb"}, "correlationId": {Value: "bbbbbbbbbbbbbbbb"}, "number": {Value: "INC2"}, "state": {Value: "2"}})
	p := &fakePusher{err: fmt.Errorf("x: %w", ErrServiceUnavailable)}
	res, err := pushService(g, p).PushPending(context.Background(), "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(p.pushed) != 1 || res.Failed != 1 || res.Deferred != 1 {
		t.Errorf("pushed %d res %+v", len(p.pushed), res)
	}
}

func TestPatchToWontFixQueuesAPushForATicketedIssue(t *testing.T) {
	g := pendingGraph("2", SyncSynced)
	wf := StatusWontFix
	got, err := ticketService(g, newCreator()).Patch(context.Background(), validID, Patch{Status: &wf}, alice, "t")
	if err != nil {
		t.Fatal(err)
	}
	if got.SyncState != SyncPending || got.ResolvedBy != "alice" {
		t.Errorf("issue = %+v", got)
	}
	// a ticketless issue stays `none`
	plain := &fakeGraph{bindings: []map[string]graphdb.Binding{openIssue()}}
	got, _ = ticketService(plain, newCreator()).Patch(context.Background(), validID, Patch{Status: &wf}, alice, "t")
	if got.SyncState != SyncNone {
		t.Errorf("ticketless sync = %q", got.SyncState)
	}
}

func TestSyncOffQueuesNoPushesButExplicitPushStillWorks(t *testing.T) {
	g := pendingGraph("2", SyncSynced)
	svc := ticketService(g, newCreator())
	svc.EnableTickets(newCreator(), TicketOptions{AppURL: appURL, BulkCap: 25, NoAutoPush: true})
	wf := StatusWontFix
	got, err := svc.Patch(context.Background(), validID, Patch{Status: &wf}, alice, "t")
	if err != nil || got.SyncState != SyncSynced {
		t.Errorf("patch with sync off: %+v %v", got, err)
	}

	// the reconcile does not queue either
	i := sample()
	i.Status, i.ResolvedBy = StatusResolved, SystemUser
	_ = i.AddTicket(Ticket{CorrelationID: i.ID, Number: "INC1", State: "2"})
	i.SyncState = SyncSynced
	repo := newMemRepo(i)
	if _, err := Reconcile(context.Background(), repo, []validation.Violation{viol(i.ID)}, nil, "u", "U", t2, WithoutPush()); err != nil {
		t.Fatal(err)
	}
	if got := repo.byID[i.ID]; got.Status != StatusOpen || got.SyncState != SyncSynced {
		t.Errorf("reconcile queued a push: %+v", got)
	}
}

func TestPendingPushesCountsWhatPushPendingWouldSend(t *testing.T) {
	g := pendingGraph("2", SyncPending)
	n, err := pushService(g, &fakePusher{}).PendingPushes(context.Background())
	if err != nil || n != 1 {
		t.Errorf("n = %d err %v", n, err)
	}
	if len(g.updates) != 0 {
		t.Errorf("counting wrote: %v", g.updates)
	}
}
