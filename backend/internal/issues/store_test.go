package issues

import (
	"context"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

type fakeGraph struct {
	updates  []string
	queries  []string
	bindings []map[string]graphdb.Binding
	// ticketBindings answers the ticket query of a read (STORY-395); everything else gets bindings.
	ticketBindings []map[string]graphdb.Binding
}

func (g *fakeGraph) Update(_ context.Context, u string) error {
	g.updates = append(g.updates, u)
	return nil
}

func (g *fakeGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	r.Results.Bindings = g.bindings
	if strings.Contains(q, "#Ticket>") {
		r.Results.Bindings = g.ticketBindings
	}
	return r, nil
}

const base = "http://example.org/o"

const validID = "abcdefghij234567"

func sample() Issue {
	return Issue{
		ID: validID, IndividualIri: base + "#app1", TypeIri: base + "#App", RuleId: "arm-s:7", ShapeIri: base + "/shapes#S",
		Path: base + "#owner", Constraint: "minCount", IndividualLabel: `App "One"`, Message: "owner missing",
		QualityDimension: "completeness", Status: StatusOpen, CreatedAt: "2026-01-01T00:00:00.000Z",
		UpdatedBy: "system", UpdatedAt: "2026-01-01T00:00:00.000Z", LastSeenAt: "2026-01-01T00:00:00.000Z",
	}
}

func TestGraphIRIIsDerivedFromTheDefaultNamespace(t *testing.T) {
	if got := GraphIRI(base); got != base+"/issues" {
		t.Errorf("GraphIRI = %q", got)
	}
	if got := GraphIRI(base + "/"); got != base+"/issues" {
		t.Errorf("GraphIRI with slash = %q", got)
	}
}

func TestBulkCreateWritesOnlyToTheIssuesGraph(t *testing.T) {
	g := &fakeGraph{}
	a, b := sample(), sample()
	b.ID = "bbbbbbbbbbbbbbbb"
	if err := NewStore(g, base).BulkCreate(context.Background(), []Issue{a, b}); err != nil {
		t.Fatal(err)
	}
	if len(g.updates) != 1 {
		t.Fatalf("updates = %d, want one bulk update", len(g.updates))
	}
	u := g.updates[0]
	for _, want := range []string{"INSERT DATA", "GRAPH <" + base + "/issues>", "<" + base + "/issues#" + validID + ">", `App \"One\"`, `"open"`} {
		if !strings.Contains(u, want) {
			t.Errorf("update lacks %q:\n%s", want, u)
		}
	}
	for _, other := range []string{"/schema>", "/shapes>", "GRAPH <" + base + ">"} {
		if strings.Contains(u, other) {
			t.Errorf("update touches %q", other)
		}
	}
}

func TestUpdateReplacesTheNode(t *testing.T) {
	g := &fakeGraph{}
	if err := NewStore(g, base).Update(context.Background(), sample()); err != nil {
		t.Fatal(err)
	}
	u := g.updates[0]
	if !strings.Contains(u, "DELETE WHERE") || !strings.Contains(u, "INSERT DATA") {
		t.Errorf("update = %s", u)
	}
}

func TestInvalidInputIsAnInputError(t *testing.T) {
	cases := map[string]func(*Issue){
		"status":      func(i *Issue) { i.Status = "done" },
		"id":          func(i *Issue) { i.ID = "x>y" },
		"note":        func(i *Issue) { i.Note = strings.Repeat("n", MaxNote+1) },
		"assignee":    func(i *Issue) { i.Assignee = strings.Repeat("a", MaxSub+1) },
		"externalId":  func(i *Issue) { i.ExternalID = strings.Repeat("e", MaxExternal+1) },
		"resolvedBy":  func(i *Issue) { i.ResolvedBy = "x" }, // open issue cannot carry a resolver
		"individual":  func(i *Issue) { i.IndividualIri = "a b" },
		"emptyStatus": func(i *Issue) { i.Status = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			i := sample()
			mutate(&i)
			g := &fakeGraph{}
			err := NewStore(g, base).BulkCreate(context.Background(), []Issue{i})
			if err == nil || !IsInputError(err) {
				t.Errorf("err = %v, want an input error", err)
			}
			if len(g.updates) != 0 {
				t.Error("an invalid issue was written")
			}
		})
	}
}

func TestListBuildsBoundedFilteredQueries(t *testing.T) {
	g := &fakeGraph{}
	_, err := NewStore(g, base).List(context.Background(), Filter{Status: StatusOpen, Assignee: "al\"ice", RuleID: "arm-s:7", IndividualIri: base + "#app1", Limit: 100000, Offset: 5})
	if err != nil {
		t.Fatal(err)
	}
	q := g.queries[0]
	for _, want := range []string{"FROM <" + base + "/issues>", `"open"`, `al\"ice`, `"arm-s:7"`, "<" + base + "#app1>", "OFFSET 5"} {
		if !strings.Contains(q, want) && !strings.Contains(q, strings.ReplaceAll(want, "<"+base+"#app1>", `"`+base+`#app1"`)) {
			t.Errorf("query lacks %q:\n%s", want, q)
		}
	}
	if !strings.Contains(q, "LIMIT 500") {
		t.Errorf("limit not clamped:\n%s", q)
	}
	if _, err := NewStore(g, base).List(context.Background(), Filter{Status: "bogus"}); !IsInputError(err) {
		t.Errorf("bad status filter err = %v", err)
	}
}

func TestGetRejectsAnUnsafeID(t *testing.T) {
	if _, _, err := NewStore(&fakeGraph{}, base).Get(context.Background(), "a>b"); !IsInputError(err) {
		t.Errorf("err = %v", err)
	}
}

func TestGetMapsBindings(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{
		"id": {Value: validID}, "status": {Value: "resolved"}, "resolvedBy": {Value: "system"}, "individualIri": {Value: base + "#app1"},
	}}}
	got, ok, err := NewStore(g, base).Get(context.Background(), validID)
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
	if got.ID != validID || got.Status != StatusResolved || got.ResolvedBy != "system" {
		t.Errorf("issue = %+v", got)
	}
	g.bindings = nil
	if _, ok, _ := NewStore(g, base).Get(context.Background(), validID); ok {
		t.Error("missing issue reported present")
	}
}

func TestTheValueIsStoredEvenWhenEmptyAndReadBack(t *testing.T) {
	g := &fakeGraph{}
	i := sample()
	i.Value = ptr("")
	if err := NewStore(g, base).BulkCreate(context.Background(), []Issue{i}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(g.updates[0], "<"+base+"/issues#value> \"\"") {
		t.Errorf("empty value not stored:\n%s", g.updates[0])
	}
	g.updates = nil
	if err := NewStore(g, base).BulkCreate(context.Background(), []Issue{sample()}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(g.updates[0], "#value>") {
		t.Error("an absent value was stored")
	}
	g.bindings = []map[string]graphdb.Binding{{"id": {Value: validID}, "value": {Value: ""}}}
	got, _, _ := NewStore(g, base).Get(context.Background(), validID)
	if got.Value == nil || *got.Value != "" {
		t.Errorf("value = %v", got.Value)
	}
	g.bindings = []map[string]graphdb.Binding{{"id": {Value: validID}}}
	got, _, _ = NewStore(g, base).Get(context.Background(), validID)
	if got.Value != nil {
		t.Errorf("absent value read as %q", *got.Value)
	}
}

func TestTheLastRunIsStoredAndReadBack(t *testing.T) {
	g := &fakeGraph{}
	s := NewStore(g, base)
	rec := RunRecord{At: t1, NotChecked: []validation.NotChecked{{ShapeIri: base + "/shapes#S", Construct: "sh:xone", Reason: "no \"quote\""}}}
	if err := s.SaveRun(context.Background(), rec); err != nil {
		t.Fatal(err)
	}
	u := g.updates[0]
	for _, want := range []string{"DELETE WHERE", "GRAPH <" + base + "/issues>", "<" + base + "/issues#lastRun>", "sh:xone"} {
		if !strings.Contains(u, want) {
			t.Errorf("update lacks %q:\n%s", want, u)
		}
	}
	g.bindings = []map[string]graphdb.Binding{{"at": {Value: t1}, "notChecked": {Value: `[{"shapeIri":"s","ruleId":"","construct":"sh:xone","reason":"r"}]`}}}
	got, ok, err := s.LastRun(context.Background())
	if err != nil || !ok || got.At != t1 || len(got.NotChecked) != 1 || got.NotChecked[0].Construct != "sh:xone" {
		t.Errorf("got %+v ok=%v err=%v", got, ok, err)
	}
	g.bindings = nil
	if _, ok, _ := s.LastRun(context.Background()); ok {
		t.Error("no run reported present")
	}
}
