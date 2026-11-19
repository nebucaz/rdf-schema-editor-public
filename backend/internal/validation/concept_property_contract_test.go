package validation

// Contract test of the generated concept-property constraint (spec/concept-valued-properties STORY-434).
//
// What it proves: every select text the TS generator produces (testdata/golden/concept-property.json)
// passes ValidateSelect, tampered variants are rejected, and canned rows come out as findings carrying
// the value, the property as path and the shape's message, for a shape with no rule id.
//
// What it does NOT prove: that the select returns the right rows on GraphDB (an unscoped select seeing
// `<base>/vocab`). That is the human runbook (STORY-442).

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

type conceptPropertyVector struct {
	Name        string `json:"name"`
	PropertyIri string `json:"propertyIri"`
	SchemeIri   string `json:"schemeIri"`
	Select      string `json:"select"`
}

func loadConceptPropertyVectors(t *testing.T) []conceptPropertyVector {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/golden/concept-property.json")
	if err != nil {
		t.Fatalf("read golden file: %v", err)
	}
	var golden struct {
		Vectors []conceptPropertyVector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatalf("parse golden file: %v", err)
	}
	if len(golden.Vectors) == 0 {
		t.Fatal("no vectors in the golden file")
	}
	return golden.Vectors
}

func TestConceptProperty_GoldenSelectsPassValidateSelect(t *testing.T) {
	for _, v := range loadConceptPropertyVectors(t) {
		if err := ValidateSelect(v.Select); err != nil {
			t.Errorf("%s: ValidateSelect() = %v", v.Name, err)
		}
	}
}

func TestConceptProperty_TamperedSelectsAreRejected(t *testing.T) {
	v := loadConceptPropertyVectors(t)[0]
	tampered := map[string]string{
		"SERVICE":        strings.Replace(v.Select, "FILTER NOT EXISTS {", "SERVICE <http://evil/sparql> { ?x ?y ?z } FILTER NOT EXISTS {", 1),
		"unicode escape": strings.Replace(v.Select, "?value a", "?value "+`\`+"u0061", 1),
		"second SELECT":  v.Select + "\nSELECT $this ?value WHERE { $this ?p ?value }",
	}
	for name, text := range tampered {
		if err := ValidateSelect(text); err == nil {
			t.Errorf("%s: ValidateSelect() accepted %q", name, text)
		}
	}
}

func TestConceptProperty_CannedRowsBecomeFindingsWithoutRuleId(t *testing.T) {
	v := loadConceptPropertyVectors(t)[0]
	constraint := SparqlConstraint{
		ShapeIri: "http://ns#S", TargetClass: "http://ns#App", Select: v.Select,
		Message: "lifecycleStage must be a concept of the scheme Lifecycle",
	}
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(map[string]graphdb.Binding{"this": uri("http://ex#a-app"), "value": uri("http://ex#NotAConcept"), "path": uri(v.PropertyIri)}), nil
	}}
	violations, notChecked := CheckSparql(context.Background(), runner, sparqlSnapshot(constraint))
	if len(notChecked) != 0 {
		t.Fatalf("notChecked = %+v, want none", notChecked)
	}
	if len(violations) != 1 {
		t.Fatalf("violations = %+v", violations)
	}
	got := violations[0]
	if got.Value == nil || *got.Value != "http://ex#NotAConcept" || got.Path != v.PropertyIri ||
		got.Message != constraint.Message || got.RuleId != "" || got.Constraint != "sparql" {
		t.Errorf("violation = %+v", got)
	}
}

func TestIgnoredPropertyKeys_TheValueSchemeMarkerIsNotReportedAsNotChecked(t *testing.T) {
	// The marker's namespace is configurable (`PUBLIC_SCHEMA_NAMESPACE`), so it is recognised by its local name.
	for _, key := range []string{"http://ld.pageagent.com/rdf-schema-editor/schema#valueScheme", "http://other.example/ns#valueScheme"} {
		if !isIgnoredPropertyKey(key) {
			t.Errorf("isIgnoredPropertyKey(%q) = false, want true", key)
		}
	}
	if isIgnoredPropertyKey("http://www.w3.org/ns/shacl#in") {
		t.Error("sh:in must still be reported as not checked")
	}
}
