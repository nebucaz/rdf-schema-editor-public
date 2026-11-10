package changelog

import (
	"context"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

type fakeGraph struct {
	updates  []string
	queries  []string
	bindings []map[string]graphdb.Binding
}

func (g *fakeGraph) Update(_ context.Context, u string) error {
	g.updates = append(g.updates, u)
	return nil
}
func (g *fakeGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	r.Results.Bindings = g.bindings
	return r, nil
}

const ns = "http://example.org/o"

func svc(g *fakeGraph) *Service {
	s := New(g, ns)
	s.mint = func() string { return "T1" }
	return s
}

func TestAddWritesOneEntryWithTheServersStamp(t *testing.T) {
	g := &fakeGraph{}
	iri, err := svc(g).Add(context.Background(), Entry{
		Kind: "change", Summary: `Added "Bank"`, Rationale: "CQ-3 needs it", Term: ns + "/vocab#Bank",
		Question: ns + "#CQ3", ChangeKind: "addition", Version: "",
	}, "alice", "2026-03-04T05:06:07.089Z")
	if err != nil {
		t.Fatal(err)
	}
	if iri != ns+"/schema#ChangeLogEntryT1" {
		t.Errorf("iri = %q", iri)
	}
	if len(g.updates) != 1 {
		t.Fatalf("updates = %d", len(g.updates))
	}
	u := g.updates[0]
	for _, want := range []string{
		"GRAPH <" + ns + "/schema>", `"alice"`, `"2026-03-04T05:06:07.089Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>`,
		`Added \"Bank\"`, "<" + ns + "/vocab#Bank>", "<" + ns + "#CQ3>", `"addition"`,
	} {
		if !strings.Contains(u, want) {
			t.Errorf("update lacks %q:\n%s", want, u)
		}
	}
	if strings.Contains(u, "versionInfo") {
		t.Error("a plain change must not touch the version")
	}
}

func TestAddRejectsBadInput(t *testing.T) {
	cases := map[string]Entry{
		"no summary":      {Kind: "change"},
		"bad kind":        {Kind: "nope", Summary: "x"},
		"unsafe term":     {Kind: "change", Summary: "x", Term: "http://x/> } DROP"},
		"unsafe question": {Kind: "change", Summary: "x", Question: "http://x/> }"},
		"bad change kind": {Kind: "change", Summary: "x", ChangeKind: "boom"},
		"release no ver":  {Kind: "release", Summary: "x", Namespace: ns},
		"bad version":     {Kind: "release", Summary: "x", Namespace: ns, Version: "1.0\"; DROP"},
		"release no ns":   {Kind: "release", Summary: "x", Version: "1.0.0"},
		"too long":        {Kind: "change", Summary: strings.Repeat("x", 600)},
	}
	for name, e := range cases {
		g := &fakeGraph{}
		_, err := svc(g).Add(context.Background(), e, "alice", "t")
		if err == nil || !IsInputError(err) {
			t.Errorf("%s: err = %v", name, err)
		}
		if len(g.updates) != 0 {
			t.Errorf("%s: wrote", name)
		}
	}
}

func TestReleaseSetsTheVersionInTheSameUpdate(t *testing.T) {
	g := &fakeGraph{}
	_, err := svc(g).Add(context.Background(), Entry{Kind: "release", Summary: "Notes", Version: "1.2.0", Namespace: ns + "/core"}, "bob", "t")
	if err != nil {
		t.Fatal(err)
	}
	if len(g.updates) != 1 {
		t.Fatalf("updates = %d", len(g.updates))
	}
	u := g.updates[0]
	if !strings.Contains(u, "DELETE WHERE") || !strings.Contains(u, "<"+ns+"/core> <http://www.w3.org/2002/07/owl#versionInfo> ?old") {
		t.Errorf("old version not removed:\n%s", u)
	}
	if !strings.Contains(u, `<`+ns+`/core> <http://www.w3.org/2002/07/owl#versionInfo> "1.2.0"`) {
		t.Errorf("new version missing:\n%s", u)
	}
}

func TestListFiltersAndParses(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{
		"e": {Value: ns + "/schema#ChangeLogEntryA"}, "summary": {Value: "s"}, "by": {Value: "alice"},
		"at": {Value: "2026-01-01T00:00:00Z"}, "kind": {Value: "change"}, "term": {Value: ns + "#T"},
	}}}
	got, err := svc(g).List(context.Background(), Filter{Term: ns + "#T", Question: ns + "#CQ", Version: "1.0.0"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ChangedBy != "alice" || got[0].Term != ns+"#T" {
		t.Errorf("got %+v", got)
	}
	q := g.queries[0]
	for _, want := range []string{"<" + ns + "#T>", "<" + ns + "#CQ>", `"1.0.0"`, "FROM <" + ns + "/schema>"} {
		if !strings.Contains(q, want) {
			t.Errorf("query lacks %q:\n%s", want, q)
		}
	}
	if _, err := svc(g).List(context.Background(), Filter{Term: "http://x/> }"}); !IsInputError(err) {
		t.Errorf("unsafe filter accepted: %v", err)
	}
}

func TestChangeEntryIsStampedWithTheVocabularyNamespacesCurrentVersion(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{"v": {Value: "1.1.0"}}}}
	if _, err := svc(g).Add(context.Background(), Entry{Kind: "change", Summary: "x"}, "alice", "t"); err != nil {
		t.Fatal(err)
	}
	if len(g.queries) != 1 || !strings.Contains(g.queries[0], "vocabularyNamespace") {
		t.Errorf("version lookup = %v", g.queries)
	}
	if !strings.Contains(g.updates[0], `changeVersion> "1.1.0"`) {
		t.Errorf("version not stamped:\n%s", g.updates[0])
	}
}

func TestAClientVersionOnAChangeIsKept(t *testing.T) {
	g := &fakeGraph{bindings: []map[string]graphdb.Binding{{"v": {Value: "9.9.9"}}}}
	if _, err := svc(g).Add(context.Background(), Entry{Kind: "change", Summary: "x", Version: "2.0.0"}, "alice", "t"); err != nil {
		t.Fatal(err)
	}
	if len(g.queries) != 0 || !strings.Contains(g.updates[0], `"2.0.0"`) {
		t.Errorf("queries %v update %s", g.queries, g.updates[0])
	}
}
