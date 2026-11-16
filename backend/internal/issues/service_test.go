package issues

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

func str(s string) *string { return &s }

var alice = Actor{Sub: "alice", DisplayName: "Alice A", Email: "a@x.example"}

func issueBinding() []map[string]graphdb.Binding {
	return []map[string]graphdb.Binding{{"id": {Value: validID}, "status": {Value: "open"}, "individualIri": {Value: base + "#app1"}}}
}

func TestExternalURLFollowsTheTemplate(t *testing.T) {
	tpl := "https://x.service-now.com/nav_to.do?uri=incident.do?number={id}"
	if got := ExternalURL(tpl, "INC 1&2"); got != "https://x.service-now.com/nav_to.do?uri=incident.do?number=INC+1%262" {
		t.Errorf("url = %q", got)
	}
	if ExternalURL("", "INC1") != "" || ExternalURL(tpl, "") != "" {
		t.Error("empty template or id must give no URL")
	}
}

func TestPatchStampsFromTheActorAndRecordsUserResolution(t *testing.T) {
	g := &fakeGraph{bindings: issueBinding()}
	svc := NewService(NewStore(g, base), base, "https://t.example/?n={id}")
	got, err := svc.Patch(context.Background(), validID, Patch{Status: str("resolved"), Note: str("done"), ExternalID: str("INC1"), Assignee: str("alice")}, alice, "2026-03-01T00:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusResolved || got.ResolvedBy != "alice" || got.UpdatedBy != "alice" || got.UpdatedByName != "Alice A" ||
		got.UpdatedAt != "2026-03-01T00:00:00.000Z" || got.AssigneeName != "Alice A" || got.ExternalURL != "https://t.example/?n=INC1" {
		t.Errorf("issue = %+v", got)
	}
	if len(g.updates) != 1 || !strings.Contains(g.updates[0], `"done"`) {
		t.Errorf("updates = %v", g.updates)
	}
	if strings.Contains(g.updates[0], "t.example") {
		t.Error("the derived external URL was stored")
	}
}

func TestPatchRejectsBadStatusAndUnknownID(t *testing.T) {
	g := &fakeGraph{bindings: issueBinding()}
	svc := NewService(NewStore(g, base), base, "")
	if _, err := svc.Patch(context.Background(), validID, Patch{Status: str("done")}, alice, "t"); !IsInputError(err) {
		t.Errorf("bad status err = %v", err)
	}
	if _, err := svc.Patch(context.Background(), validID, Patch{Assignee: str(strings.Repeat("a", MaxSub+1))}, alice, "t"); !IsInputError(err) {
		t.Errorf("long assignee err = %v", err)
	}
	g.bindings = nil
	if _, err := svc.Patch(context.Background(), validID, Patch{Note: str("x")}, alice, "t"); !IsNotFound(err) {
		t.Errorf("unknown id err = %v", err)
	}
	if len(g.updates) != 0 {
		t.Error("a rejected patch wrote")
	}
}

func TestPatchReopeningClearsTheResolver(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{"id": {Value: validID}, "status": {Value: "wontfix"}, "resolvedBy": {Value: "bob"}}}}
	got, err := NewService(NewStore(g, base), base, "").Patch(context.Background(), validID, Patch{Status: str("open")}, alice, "t")
	if err != nil || got.Status != StatusOpen || got.ResolvedBy != "" {
		t.Errorf("got %+v err %v", got, err)
	}
}

func TestAssigneesAreDeduplicatedSortedAndIncludeTheCaller(t *testing.T) {
	g := &fakeSeq{}
	g.results = [][]map[string]graphdb.Binding{
		{{"sub": {Value: "bob"}, "name": {Value: "bob builder"}}, {"sub": {Value: "carol"}, "name": {Value: "Carol C"}}}, // known users
		{{"sub": {Value: "bob"}}, {"sub": {Value: "dave"}}, {"sub": {Value: "system"}}},                                  // seen subs
	}
	got, err := NewService(NewStore(g, base), base, "").Assignees(context.Background(), alice)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, a := range got {
		names = append(names, a.Sub+"="+a.DisplayName)
	}
	want := "alice=Alice A,bob=bob builder,carol=Carol C,dave=dave"
	if strings.Join(names, ",") != want {
		t.Errorf("assignees = %v, want %s", names, want)
	}
}

// fakeSeq answers successive Selects with successive result sets.
type fakeSeq struct {
	fakeGraph
	results [][]map[string]graphdb.Binding
	n       int
}

func (g *fakeSeq) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	if g.n < len(g.results) {
		r.Results.Bindings = g.results[g.n]
	}
	g.n++
	return r, nil
}

func TestDirectoryThrottlesUnchangedUsers(t *testing.T) {
	g := &fakeGraph{}
	d := NewDirectory(NewStore(g, base))
	clock := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	d.now = func() time.Time { return clock }
	u := KnownUser{Sub: "alice", DisplayName: "Alice A", Email: "a@x.example"}
	ctx := context.Background()

	_ = d.Remember(ctx, u)
	_ = d.Remember(ctx, u)
	if len(g.updates) != 1 {
		t.Fatalf("writes after two identical calls = %d, want 1", len(g.updates))
	}
	u.DisplayName = "Alice Renamed"
	_ = d.Remember(ctx, u)
	if len(g.updates) != 2 {
		t.Errorf("a changed name must write; writes = %d", len(g.updates))
	}
	clock = clock.Add(25 * time.Hour)
	_ = d.Remember(ctx, u)
	if len(g.updates) != 3 {
		t.Errorf("a stale entry must write; writes = %d", len(g.updates))
	}
	if !strings.Contains(g.updates[0], "GRAPH <"+base+"/issues>") || !strings.Contains(g.updates[0], `"Alice A"`) {
		t.Errorf("update = %s", g.updates[0])
	}
}

type failingGraph struct{ fakeGraph }

func (failingGraph) Update(context.Context, string) error { return context.DeadlineExceeded }

func TestDirectoryDoesNotCacheAFailedWrite(t *testing.T) {
	d := NewDirectory(NewStore(&failingGraph{}, base))
	u := KnownUser{Sub: "alice", DisplayName: "A"}
	if err := d.Remember(context.Background(), u); err == nil {
		t.Fatal("want the error")
	}
	if _, cached := d.cache["alice"]; cached {
		t.Error("failed write was cached")
	}
}

func TestReportReturnsTheIssuesSeenInTheLastRunAsFindings(t *testing.T) {
	g := &fakeSeq{}
	seen := map[string]graphdb.Binding{"id": {Value: validID}, "status": {Value: "wontfix"}, "individualIri": {Value: base + "#a"}, "typeIri": {Value: base + "#T"},
		"ruleId": {Value: "r"}, "message": {Value: "m"}, "value": {Value: ""}, "externalId": {Value: "INC1"}, "assignee": {Value: "bob"}, "lastSeenAt": {Value: t1}}
	stale := map[string]graphdb.Binding{"id": {Value: "bbbbbbbbbbbbbbbb"}, "status": {Value: "resolved"}, "resolvedBy": {Value: "system"}, "lastSeenAt": {Value: "2026-01-01T00:00:00.000Z"}}
	g.results = [][]map[string]graphdb.Binding{
		{{"at": {Value: t1}, "notChecked": {Value: `[{"shapeIri":"s","ruleId":"","construct":"sh:xone","reason":"r"}]`}}}, // last run
		{seen, stale}, // issues
	}
	rep, err := NewService(NewStore(g, base), base, "https://t.example/?n={id}").Report(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rep.RunAt != t1 || len(rep.NotChecked) != 1 || len(rep.Violations) != 1 || len(rep.Issues) != 1 {
		t.Fatalf("report = %+v", rep)
	}
	v, o := rep.Violations[0], rep.Issues[0]
	if v.ID != validID || v.Value == nil || *v.Value != "" || o.IsNew || o.Status != "wontfix" || o.Assignee != "bob" || o.ExternalURL != "https://t.example/?n=INC1" || o.IssueID != validID {
		t.Errorf("violation=%+v outcome=%+v", v, o)
	}
}

func TestReportBeforeTheFirstRunIsEmpty(t *testing.T) {
	g := &fakeSeq{results: [][]map[string]graphdb.Binding{nil}}
	rep, err := NewService(NewStore(g, base), base, "").Report(context.Background())
	if err != nil || rep.RunAt != "" || len(rep.Violations) != 0 || rep.Violations == nil || rep.Issues == nil || rep.NotChecked == nil {
		t.Errorf("report = %+v err=%v", rep, err)
	}
}
