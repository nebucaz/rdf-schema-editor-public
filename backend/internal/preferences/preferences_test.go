package preferences

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

const ns = "http://example.org/o"

// memGraph understands only the two shapes Service emits: the replace update and the value select. It keeps
// one value per node IRI, which is enough to prove that two users never see each other's preference.
type memGraph struct {
	values  map[string]string
	updates []string
	queries []string
}

var nodeRe = regexp.MustCompile(`<(http://example\.org/o/preferences#[0-9a-f]+)>`)
var valueRe = regexp.MustCompile(`#value> "((?:[^"\\]|\\.)*)"`)

func (g *memGraph) Update(_ context.Context, u string) error {
	g.updates = append(g.updates, u)
	if g.values == nil {
		g.values = map[string]string{}
	}
	node := nodeRe.FindStringSubmatch(u)[1]
	if m := valueRe.FindStringSubmatch(u); m != nil {
		g.values[node] = strings.NewReplacer(`\\`, `\`, `\"`, `"`).Replace(m[1])
	}
	return nil
}

func (g *memGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.queries = append(g.queries, q)
	var r graphdb.SelectResult
	if v, ok := g.values[nodeRe.FindStringSubmatch(q)[1]]; ok {
		r.Results.Bindings = []map[string]graphdb.Binding{{"value": {Type: "literal", Value: v}}}
	}
	return r, nil
}

func TestKeyAllowList(t *testing.T) {
	if !IsAllowedKey("ontology-dashboard") {
		t.Error("ontology-dashboard must be allowed")
	}
	for _, k := range []string{"", "other", "ontology-dashboard ", "../x"} {
		if IsAllowedKey(k) {
			t.Errorf("%q must not be allowed", k)
		}
	}
}

func TestGetMissingIsNil(t *testing.T) {
	v, err := New(&memGraph{}, ns).Get(context.Background(), "alice", "ontology-dashboard")
	if err != nil || v != nil {
		t.Errorf("v = %q, err = %v", v, err)
	}
}

func TestPutThenGetRoundTripsCompactJSONInThePreferencesGraph(t *testing.T) {
	g := &memGraph{}
	s := New(g, ns)
	in := []byte(`{ "version": 1, "order": ["a","b"],  "note": "say \"hi\"\n" }`)
	if err := s.Put(context.Background(), "alice", "ontology-dashboard", in, "2026-03-04T05:06:07.089Z"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(g.updates[0], "<http://example.org/o/preferences>") {
		t.Errorf("update does not target the preferences graph: %s", g.updates[0])
	}
	got, err := s.Get(context.Background(), "alice", "ontology-dashboard")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"version":1,"order":["a","b"],"note":"say \"hi\"\n"}` {
		t.Errorf("got %s", got)
	}
}

func TestTwoUsersAreIsolated(t *testing.T) {
	g := &memGraph{}
	s := New(g, ns)
	ctx := context.Background()
	if err := s.Put(ctx, "alice", "ontology-dashboard", []byte(`{"u":"alice"}`), "t"); err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "bob", "ontology-dashboard", []byte(`{"u":"bob"}`), "t"); err != nil {
		t.Fatal(err)
	}
	a, _ := s.Get(ctx, "alice", "ontology-dashboard")
	b, _ := s.Get(ctx, "bob", "ontology-dashboard")
	c, _ := s.Get(ctx, "carol", "ontology-dashboard")
	if string(a) != `{"u":"alice"}` || string(b) != `{"u":"bob"}` || c != nil {
		t.Errorf("alice=%s bob=%s carol=%s", a, b, c)
	}
}

func TestPutReplacesInOneUpdateThatDeletesBeforeInserting(t *testing.T) {
	g := &memGraph{}
	s := New(g, ns)
	_ = s.Put(context.Background(), "alice", "ontology-dashboard", []byte(`{"n":1}`), "t")
	u := g.updates[0]
	if len(g.updates) != 1 || strings.Index(u, "DELETE") > strings.Index(u, "INSERT DATA") {
		t.Errorf("update = %s", u)
	}
}

func TestPutRejectsBadInputBeforeAnyUpdate(t *testing.T) {
	g := &memGraph{}
	s := New(g, ns)
	ctx := context.Background()
	for name, c := range map[string]struct {
		key string
		val string
	}{
		"unknown key":  {"nope", `{}`},
		"invalid JSON": {"ontology-dashboard", `{"a":`},
		"empty":        {"ontology-dashboard", ``},
		"oversize":     {"ontology-dashboard", `"` + strings.Repeat("x", MaxValueBytes) + `"`},
	} {
		err := s.Put(ctx, "alice", c.key, []byte(c.val), "t")
		if err == nil || !IsInputError(err) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if len(g.updates) != 0 {
		t.Errorf("an update was sent: %v", g.updates)
	}
}

func TestPreferencesGraphIsNotANamespaceGraph(t *testing.T) {
	graphs := sparqlsafe.NamespaceGraphs(ns)
	for _, g := range []string{graphs.Instances, graphs.Schema, graphs.Shapes, graphs.Catalog} {
		if g == ns+"/preferences" {
			t.Errorf("%s collides with the preferences graph", g)
		}
	}
}
