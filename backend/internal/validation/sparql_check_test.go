package validation

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

func sparqlSnapshot(constraints ...SparqlConstraint) ValidationSnapshot {
	return ValidationSnapshot{
		SubClassOf: map[string][]string{"http://ns#SubApp": {"http://ns#App"}},
		IndividualTypes: map[string][]string{
			"http://ex#b-sub":   {"http://ns#SubApp"},
			"http://ex#a-app":   {"http://ns#App"},
			"http://ex#c-other": {"http://ns#Other"},
		},
		SparqlConstraints: constraints,
	}
}

func selectConstraint(rule string) SparqlConstraint {
	return SparqlConstraint{
		ShapeIri: "http://ns#" + rule, TargetClass: "http://ns#App", RuleId: rule,
		Select: `SELECT $this ?value WHERE { $this <http://ns#p> ?value }`, Message: "bad " + rule,
	}
}

func TestCheckSparql_FocusNodesAreTargetClassAndSubclassesOnly(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) { return rowsResult(), nil }}
	violations, notChecked := CheckSparql(context.Background(), runner, sparqlSnapshot(selectConstraint("R1")))
	if len(violations) != 0 || len(notChecked) != 0 {
		t.Fatalf("violations = %+v, notChecked = %+v", violations, notChecked)
	}
	if len(runner.queries) != 1 {
		t.Fatalf("queries = %d, want 1", len(runner.queries))
	}
	q := runner.queries[0]
	if !strings.Contains(q, "<http://ex#a-app>") || !strings.Contains(q, "<http://ex#b-sub>") || strings.Contains(q, "c-other") {
		t.Errorf("focus nodes wrong in %s", q)
	}
}

func TestCheckSparql_ViolationsCarryTheShapeAndTheMatchingType(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(map[string]graphdb.Binding{"this": uri("http://ex#b-sub"), "value": literal("v"), "path": uri("http://ns#p")}), nil
	}}
	violations, _ := CheckSparql(context.Background(), runner, sparqlSnapshot(selectConstraint("R1")))
	if len(violations) != 1 {
		t.Fatalf("violations = %+v", violations)
	}
	v := violations[0]
	if v.Constraint != "sparql" || v.RuleId != "R1" || v.TypeIri != "http://ns#SubApp" || v.IndividualLabel != "b-sub" || v.Message != "bad R1" || v.Path != "http://ns#p" {
		t.Errorf("violation = %+v", v)
	}
}

func TestCheckSparql_RowForAnUnknownNodeIsIgnored(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(map[string]graphdb.Binding{"this": uri("http://ex#c-other")}), nil
	}}
	violations, _ := CheckSparql(context.Background(), runner, sparqlSnapshot(selectConstraint("R1")))
	if len(violations) != 0 {
		t.Errorf("violations = %+v, want none for a node outside the focus set", violations)
	}
}

func TestCheckSparql_OneFailingConstraintDoesNotFailTheOthers(t *testing.T) {
	runner := &fakeRunner{}
	runner.answer = func(query string) (graphdb.SelectResult, error) {
		if len(runner.queries) == 1 {
			return graphdb.SelectResult{}, errors.New("GraphDB SELECT failed: status 500")
		}
		return rowsResult(map[string]graphdb.Binding{"this": uri("http://ex#a-app")}), nil
	}
	violations, notChecked := CheckSparql(context.Background(), runner, sparqlSnapshot(selectConstraint("R1"), selectConstraint("R2")))
	if len(violations) != 1 || violations[0].RuleId != "R2" {
		t.Errorf("violations = %+v, want the finding of R2", violations)
	}
	if len(notChecked) != 1 || notChecked[0].RuleId != "R1" {
		t.Errorf("notChecked = %+v, want R1", notChecked)
	}
}

func TestCheckSparql_OrderIsIndividualThenRuleId(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(
			map[string]graphdb.Binding{"this": uri("http://ex#b-sub")},
			map[string]graphdb.Binding{"this": uri("http://ex#a-app")},
		), nil
	}}
	violations, _ := CheckSparql(context.Background(), runner, sparqlSnapshot(selectConstraint("R2"), selectConstraint("R1")))
	var got []string
	for _, v := range violations {
		got = append(got, v.IndividualLabel+":"+v.RuleId)
	}
	if strings.Join(got, ",") != "a-app:R1,a-app:R2,b-sub:R1,b-sub:R2" {
		t.Errorf("order = %v", got)
	}
}

func TestCheckAll_WithoutSparqlConstraintsRunsNoQueries(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		t.Fatal("runner must not be called")
		return graphdb.SelectResult{}, nil
	}}
	snapshot := ValidationSnapshot{
		OwnConstraints:  map[string][]PropertyConstraint{"App": {{Path: "id", MinCount: intPtr(1)}}},
		IndividualTypes: map[string][]string{"r1": {"App"}},
	}
	result := CheckAll(context.Background(), runner, snapshot)
	if len(result.Violations) != 1 || len(runner.queries) != 0 {
		t.Errorf("result = %+v, queries = %d", result, len(runner.queries))
	}
}

func TestCheckAll_MergesInMemoryAndSparqlFindingsPerIndividual(t *testing.T) {
	runner := &fakeRunner{answer: func(string) (graphdb.SelectResult, error) {
		return rowsResult(map[string]graphdb.Binding{"this": uri("http://ex#a-app")}), nil
	}}
	snapshot := sparqlSnapshot(selectConstraint("R1"))
	snapshot.OwnConstraints = map[string][]PropertyConstraint{"http://ns#App": {{Path: "http://ns#p", MinCount: intPtr(1), RuleId: "R0"}}}
	result := CheckAll(context.Background(), runner, snapshot)
	var got []string
	for _, v := range result.Violations {
		got = append(got, v.IndividualLabel+":"+v.RuleId+":"+v.Constraint)
	}
	// c-other is not an App; a-app and b-sub miss ns#p (minCount) and a-app also fails R1.
	if strings.Join(got, ",") != "a-app:R0:minCount,a-app:R1:sparql,b-sub:R0:minCount" {
		t.Errorf("violations = %v", got)
	}
}
