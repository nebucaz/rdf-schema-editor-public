package validation

// This file deliberately does not add a backend/internal/graphdbtest-backed integration test
// (STORY-128's "evaluated for an integration-level test... add it if graphdbtest makes this cheap,
// skip with a documented reason if not"). graphdbtest matches queries by fixed literal-structure
// regexes keyed to internal/sync's existing small, single-GRAPH-block query shapes; this package's
// own queries have a materially different shape it doesn't support today — multiple independent
// `GRAPH ?g { ... }` blocks joined in one query (fetchIndividualTypes/fetchIndividualValues) and a
// `sh:or/rdf:rest*/rdf:first/sh:class` property-path traversal (fetchOwnConstraints' second query).
// Extending graphdbtest's regex matcher to understand either would be new parsing surface
// disproportionate to what these fixture-`graphdb.SelectResult`-based unit tests below already
// cover just as well.

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// assertUnscoped fails t if query contains an explicit `FROM <...>` clause or a fixed `GRAPH <...>`
// clause — STORY-128's AC that every query here runs unscoped (only `GRAPH ?var`, never `FROM` or a
// literal graph IRI), so a full validation run needs no per-namespace loop.
func assertUnscoped(t *testing.T, query string) {
	t.Helper()
	if strings.Contains(query, "FROM <") || strings.Contains(query, "FROM NAMED") {
		t.Errorf("query is scoped by an explicit FROM clause, want unscoped: %s", query)
	}
	if strings.Contains(query, "GRAPH <") {
		t.Errorf("query is scoped by a fixed GRAPH <iri> clause, want GRAPH ?var: %s", query)
	}
}

func newCapturingServer(t *testing.T, respond func(query string) string) (*httptest.Server, *string) {
	t.Helper()
	var lastQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		lastQuery = r.FormValue("query")
		w.Header().Set("Content-Type", "application/sparql-results+json")
		fmt.Fprint(w, respond(lastQuery))
	}))
	return server, &lastQuery
}

func TestFetchSubClassOf(t *testing.T) {
	server, lastQuery := newCapturingServer(t, func(query string) string {
		return `{"results":{"bindings":[
			{"sub":{"type":"uri","value":"http://ns#Employee"},"super":{"type":"uri","value":"http://ns#Person"}},
			{"sub":{"type":"uri","value":"http://ns#Manager"},"super":{"type":"uri","value":"http://ns#Employee"}}
		]}}`
	})
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	edges, err := fetchSubClassOf(context.Background(), gdb)
	if err != nil {
		t.Fatalf("fetchSubClassOf() error = %v", err)
	}
	assertUnscoped(t, *lastQuery)

	if edges["http://ns#Employee"][0] != "http://ns#Person" {
		t.Errorf("edges[Employee] = %v, want [Person]", edges["http://ns#Employee"])
	}
	if edges["http://ns#Manager"][0] != "http://ns#Employee" {
		t.Errorf("edges[Manager] = %v, want [Employee]", edges["http://ns#Manager"])
	}
}

func TestFetchOwnConstraints_PlainSHClass(t *testing.T) {
	calls := 0
	server, lastQuery := newCapturingServer(t, func(query string) string {
		calls++
		if strings.Contains(query, "rdf-syntax-ns#rest") {
			// The sh:or query (contains the rdf:rest* property-path quantifier) — no unions in this test.
			return `{"results":{"bindings":[]}}`
		}
		return `{"results":{"bindings":[
			{"class":{"type":"uri","value":"http://ns#Person"},"path":{"type":"uri","value":"http://ns#name"},"minCount":{"type":"literal","value":"1"}},
			{"class":{"type":"uri","value":"http://ns#Person"},"path":{"type":"uri","value":"http://ns#manager"},"maxCount":{"type":"literal","value":"1"},"targetClass":{"type":"uri","value":"http://ns#Person"}}
		]}}`
	})
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	own, err := fetchOwnConstraints(context.Background(), gdb)
	if err != nil {
		t.Fatalf("fetchOwnConstraints() error = %v", err)
	}
	if calls != 2 {
		t.Fatalf("fetchOwnConstraints() issued %d queries, want 2 (general + sh:or)", calls)
	}
	assertUnscoped(t, *lastQuery)

	constraints := own["http://ns#Person"]
	if len(constraints) != 2 {
		t.Fatalf("own[Person] = %+v, want 2 constraints", constraints)
	}
	byPath := map[string]PropertyConstraint{}
	for _, c := range constraints {
		byPath[c.Path] = c
	}
	name := byPath["http://ns#name"]
	if name.MinCount == nil || *name.MinCount != 1 {
		t.Errorf("name.MinCount = %v, want 1", name.MinCount)
	}
	manager := byPath["http://ns#manager"]
	if manager.MaxCount == nil || *manager.MaxCount != 1 {
		t.Errorf("manager.MaxCount = %v, want 1", manager.MaxCount)
	}
	if len(manager.TargetClasses) != 1 || manager.TargetClasses[0] != "http://ns#Person" {
		t.Errorf("manager.TargetClasses = %v, want [http://ns#Person]", manager.TargetClasses)
	}
}

func TestFetchOwnConstraints_ShOrUnwoundToMultipleTargets(t *testing.T) {
	server, _ := newCapturingServer(t, func(query string) string {
		if strings.Contains(query, "rdf-syntax-ns#rest") {
			return `{"results":{"bindings":[
				{"class":{"type":"uri","value":"http://ns#Assignment"},"path":{"type":"uri","value":"http://ns#target"},"targetClass":{"type":"uri","value":"http://ns#Component"}},
				{"class":{"type":"uri","value":"http://ns#Assignment"},"path":{"type":"uri","value":"http://ns#target"},"targetClass":{"type":"uri","value":"http://ns#System"}}
			]}}`
		}
		return `{"results":{"bindings":[
			{"class":{"type":"uri","value":"http://ns#Assignment"},"path":{"type":"uri","value":"http://ns#target"},"minCount":{"type":"literal","value":"1"}}
		]}}`
	})
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	own, err := fetchOwnConstraints(context.Background(), gdb)
	if err != nil {
		t.Fatalf("fetchOwnConstraints() error = %v", err)
	}

	constraints := own["http://ns#Assignment"]
	if len(constraints) != 1 {
		t.Fatalf("own[Assignment] = %+v, want exactly 1 merged constraint for the single path", constraints)
	}
	targets := constraints[0].TargetClasses
	want := map[string]bool{"http://ns#Component": true, "http://ns#System": true}
	if len(targets) != 2 || !want[targets[0]] || !want[targets[1]] {
		t.Errorf("targetClasses = %v, want both http://ns#Component and http://ns#System", targets)
	}
	if constraints[0].MinCount == nil || *constraints[0].MinCount != 1 {
		t.Errorf("MinCount = %v, want 1 (from the general query)", constraints[0].MinCount)
	}
}

func TestFetchIndividualTypes_MultiTypedNotCollapsed(t *testing.T) {
	server, lastQuery := newCapturingServer(t, func(query string) string {
		return `{"results":{"bindings":[
			{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Person"}},
			{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Employee"}}
		]}}`
	})
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	types, err := fetchIndividualTypes(context.Background(), gdb)
	if err != nil {
		t.Fatalf("fetchIndividualTypes() error = %v", err)
	}
	assertUnscoped(t, *lastQuery)

	got := types["http://ns#alice"]
	if len(got) != 2 {
		t.Fatalf("types[alice] = %v, want 2 types, not collapsed to one", got)
	}
}

func TestFetchIndividualValues_LiteralDefaultsToXsdString(t *testing.T) {
	server, lastQuery := newCapturingServer(t, func(query string) string {
		return `{"results":{"bindings":[
			{"individual":{"type":"uri","value":"http://ns#alice"},"p":{"type":"uri","value":"http://www.w3.org/1999/02/22-rdf-syntax-ns#type"},"o":{"type":"uri","value":"http://ns#Person"}},
			{"individual":{"type":"uri","value":"http://ns#alice"},"p":{"type":"uri","value":"http://ns#name"},"o":{"type":"literal","value":"Alice"}},
			{"individual":{"type":"uri","value":"http://ns#alice"},"p":{"type":"uri","value":"http://ns#age"},"o":{"type":"literal","value":"30","datatype":"http://www.w3.org/2001/XMLSchema#integer"}},
			{"individual":{"type":"uri","value":"http://ns#alice"},"p":{"type":"uri","value":"http://ns#manager"},"o":{"type":"uri","value":"http://ns#bob"}}
		]}}`
	})
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	values, err := fetchIndividualValues(context.Background(), gdb)
	if err != nil {
		t.Fatalf("fetchIndividualValues() error = %v", err)
	}
	assertUnscoped(t, *lastQuery)
	if !strings.Contains(*lastQuery, "SELECT DISTINCT") {
		t.Errorf("query = %s, want SELECT DISTINCT to dedupe cross-type-join duplicates", *lastQuery)
	}

	got := values["http://ns#alice"]
	if len(got) != 3 {
		t.Fatalf("values[alice] = %+v, want 3 (rdf:type itself excluded)", got)
	}
	byPredicate := map[string]AssertedValue{}
	for _, v := range got {
		byPredicate[v.Predicate] = v
	}
	if byPredicate["http://ns#name"].Datatype != xsdString {
		t.Errorf("name.Datatype = %q, want the implicit xsd:string default", byPredicate["http://ns#name"].Datatype)
	}
	if byPredicate["http://ns#age"].Datatype != "http://www.w3.org/2001/XMLSchema#integer" {
		t.Errorf("age.Datatype = %q, want xsd:integer", byPredicate["http://ns#age"].Datatype)
	}
	if !byPredicate["http://ns#manager"].IsIRI {
		t.Error("manager.IsIRI = false, want true")
	}
}

func TestLoadValidationSnapshot_AssemblesAllFour(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		query := r.FormValue("query")
		w.Header().Set("Content-Type", "application/sparql-results+json")

		switch {
		case strings.Contains(query, rdfsSubClassOf):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"sub":{"type":"uri","value":"http://ns#Employee"},"super":{"type":"uri","value":"http://ns#Person"}}
			]}}`)
		case strings.Contains(query, "rdf-syntax-ns#rest"):
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
		case strings.Contains(query, shTargetClass):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"class":{"type":"uri","value":"http://ns#Person"},"path":{"type":"uri","value":"http://ns#name"},"minCount":{"type":"literal","value":"1"}}
			]}}`)
		case strings.Contains(query, "SELECT DISTINCT"):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"individual":{"type":"uri","value":"http://ns#alice"},"p":{"type":"uri","value":"http://ns#name"},"o":{"type":"literal","value":"Alice"}}
			]}}`)
		case strings.Contains(query, "?individual") && strings.Contains(query, "?type"):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Employee"}}
			]}}`)
		default:
			t.Fatalf("unexpected query: %s", query)
		}
	}))
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	snapshot, err := LoadValidationSnapshot(context.Background(), gdb)
	if err != nil {
		t.Fatalf("LoadValidationSnapshot() error = %v", err)
	}

	if snapshot.SubClassOf["http://ns#Employee"][0] != "http://ns#Person" {
		t.Errorf("SubClassOf = %v", snapshot.SubClassOf)
	}
	if len(snapshot.OwnConstraints["http://ns#Person"]) != 1 {
		t.Errorf("OwnConstraints[Person] = %v, want 1", snapshot.OwnConstraints["http://ns#Person"])
	}
	if len(snapshot.IndividualTypes["http://ns#alice"]) != 1 {
		t.Errorf("IndividualTypes[alice] = %v, want 1", snapshot.IndividualTypes["http://ns#alice"])
	}
	if len(snapshot.IndividualValues["http://ns#alice"]) != 1 {
		t.Errorf("IndividualValues[alice] = %v, want 1", snapshot.IndividualValues["http://ns#alice"])
	}
}
