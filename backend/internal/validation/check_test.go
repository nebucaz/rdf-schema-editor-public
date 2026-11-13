package validation

import (
	"encoding/json"
	"strings"
	"testing"
)

func countByConstraint(violations []Violation, constraint string) int {
	n := 0
	for _, v := range violations {
		if v.Constraint == constraint {
			n++
		}
	}
	return n
}

func TestCheckSnapshot_NoViolationsWhenAllConstraintsSatisfied(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "name", MinCount: intPtr(1)}},
		},
		IndividualTypes: map[string][]string{"alice": {"Person"}},
		IndividualValues: map[string][]AssertedValue{
			"alice": {{Predicate: "name", IsIRI: false, Value: "Alice", Datatype: xsdString}},
		},
	}
	got := CheckSnapshot(snapshot)
	if len(got) != 0 {
		t.Errorf("CheckSnapshot() = %+v, want no violations", got)
	}
}

func TestCheckSnapshot_MinCountViolation(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "name", MinCount: intPtr(1)}},
		},
		IndividualTypes:  map[string][]string{"alice": {"Person"}},
		IndividualValues: map[string][]AssertedValue{},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "minCount") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want exactly 1 minCount violation", got)
	}
}

func TestCheckSnapshot_MaxCountViolation(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "email", MaxCount: intPtr(1)}},
		},
		IndividualTypes: map[string][]string{"alice": {"Person"}},
		IndividualValues: map[string][]AssertedValue{
			"alice": {
				{Predicate: "email", Value: "a@example.com", Datatype: xsdString},
				{Predicate: "email", Value: "b@example.com", Datatype: xsdString},
			},
		},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "maxCount") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want exactly 1 maxCount violation", got)
	}
}

func TestCheckSnapshot_DatatypeViolation(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "age", Datatype: "http://www.w3.org/2001/XMLSchema#integer"}},
		},
		IndividualTypes: map[string][]string{"alice": {"Person"}},
		IndividualValues: map[string][]AssertedValue{
			"alice": {{Predicate: "age", Value: "thirty", Datatype: xsdString}},
		},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "datatype") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want exactly 1 datatype violation", got)
	}
}

func TestCheckSnapshot_DatatypePassing(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "age", Datatype: "http://www.w3.org/2001/XMLSchema#integer"}},
		},
		IndividualTypes: map[string][]string{"alice": {"Person"}},
		IndividualValues: map[string][]AssertedValue{
			"alice": {{Predicate: "age", Value: "30", Datatype: "http://www.w3.org/2001/XMLSchema#integer"}},
		},
	}
	got := CheckSnapshot(snapshot)
	if len(got) != 0 {
		t.Errorf("CheckSnapshot() = %+v, want no violations", got)
	}
}

func TestCheckSnapshot_ClassViolation_WrongType(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Assignment": {{Path: "target", TargetClasses: []string{"Component"}}},
		},
		IndividualTypes: map[string][]string{
			"assignment1": {"Assignment"},
			"thing1":      {"Widget"},
		},
		IndividualValues: map[string][]AssertedValue{
			"assignment1": {{Predicate: "target", IsIRI: true, Value: "thing1"}},
		},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "class") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want exactly 1 class violation", got)
	}
}

// TestCheckSnapshot_ClassPassing_SubclassOfTargetAccepted proves a relation value whose type is a
// *subclass* of the shape's sh:class target (not the exact class) is accepted, not flagged.
func TestCheckSnapshot_ClassPassing_SubclassOfTargetAccepted(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Assignment": {{Path: "target", TargetClasses: []string{"Component"}}},
		},
		SubClassOf: map[string][]string{"Microservice": {"Component"}},
		IndividualTypes: map[string][]string{
			"assignment1": {"Assignment"},
			"thing1":      {"Microservice"},
		},
		IndividualValues: map[string][]AssertedValue{
			"assignment1": {{Predicate: "target", IsIRI: true, Value: "thing1"}},
		},
	}
	got := CheckSnapshot(snapshot)
	if len(got) != 0 {
		t.Errorf("CheckSnapshot() = %+v, want no violations (subclass of target satisfies sh:class)", got)
	}
}

// TestCheckSnapshot_ShOrUnion_OneOptionMatches proves a value matching any one option of an sh:or
// union is accepted, and a value matching none of them is flagged with Constraint "class".
func TestCheckSnapshot_ShOrUnion_OneOptionMatches(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Assignment": {{Path: "target", TargetClasses: []string{"Component", "System"}}},
		},
		IndividualTypes: map[string][]string{
			"assignment1": {"Assignment"},
			"assignment2": {"Assignment"},
			"comp1":       {"Component"},
			"widget1":     {"Widget"},
		},
		IndividualValues: map[string][]AssertedValue{
			"assignment1": {{Predicate: "target", IsIRI: true, Value: "comp1"}},
			"assignment2": {{Predicate: "target", IsIRI: true, Value: "widget1"}},
		},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "class") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want exactly 1 class violation (assignment2 only)", got)
	}
	if got[0].IndividualIri != "assignment2" {
		t.Errorf("violation individual = %q, want assignment2", got[0].IndividualIri)
	}
}

// TestCheckSnapshot_InheritedConstraintStillFlagged proves an identity missing a constraint
// inherited from an ancestor class (not its own most-specific type) is still flagged — the whole
// point of STORY-127's merge being used here rather than a naive own-class-only check.
func TestCheckSnapshot_InheritedConstraintStillFlagged(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"Person": {{Path: "name", MinCount: intPtr(1)}},
		},
		SubClassOf:       map[string][]string{"Employee": {"Person"}},
		IndividualTypes:  map[string][]string{"alice": {"Employee"}},
		IndividualValues: map[string][]AssertedValue{},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "minCount") != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want 1 minCount violation inherited from Person", got)
	}
	if got[0].TypeIri != "Employee" {
		t.Errorf("violation.TypeIri = %q, want Employee (the identity's own declared type)", got[0].TypeIri)
	}
}

// TestCheckSnapshot_MultiTypedIdentity_TwoRowsNotDeduped proves a multi-typed identity violating
// the same path identically under two of its types produces two separate Violation rows.
func TestCheckSnapshot_MultiTypedIdentity_TwoRowsNotDeduped(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"TypeA": {{Path: "code", MinCount: intPtr(1)}},
			"TypeB": {{Path: "code", MinCount: intPtr(1)}},
		},
		IndividualTypes:  map[string][]string{"alice": {"TypeA", "TypeB"}},
		IndividualValues: map[string][]AssertedValue{},
	}
	got := CheckSnapshot(snapshot)
	if countByConstraint(got, "minCount") != 2 {
		t.Fatalf("CheckSnapshot() = %+v, want 2 undeduped minCount violations, one per type", got)
	}
}

func TestIndividualLabel_FallsBackToLocalName(t *testing.T) {
	got := individualLabel("http://ns#alice", nil)
	if got != "alice" {
		t.Errorf("individualLabel() = %q, want alice", got)
	}
}

func TestIndividualLabel_UsesRdfsLabelWhenPresent(t *testing.T) {
	got := individualLabel("http://ns#alice", []AssertedValue{{Predicate: rdfsLabel, Value: "Alice Smith"}})
	if got != "Alice Smith" {
		t.Errorf("individualLabel() = %q, want Alice Smith", got)
	}
}

func TestCheckSnapshot_ViolationCarriesRuleIdDimensionShapeAndMessage(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			"App": {{
				Path: "id", MinCount: intPtr(1),
				ShapeIri: "http://ns#ExistsShape", RuleId: "AC-EXISTS", QualityDimension: "Completeness", Message: "Technische ID fehlt.",
			}},
		},
		IndividualTypes:  map[string][]string{"r1": {"App"}},
		IndividualValues: map[string][]AssertedValue{},
	}
	got := CheckSnapshot(snapshot)
	if len(got) != 1 {
		t.Fatalf("CheckSnapshot() = %+v, want 1 violation", got)
	}
	v := got[0]
	if v.RuleId != "AC-EXISTS" || v.QualityDimension != "Completeness" || v.ShapeIri != "http://ns#ExistsShape" {
		t.Errorf("violation identity = %+v", v)
	}
	if v.Message != "Technische ID fehlt." || v.Constraint != "minCount" {
		t.Errorf("Message/Constraint = %q/%q, want the shape message and minCount", v.Message, v.Constraint)
	}
}

func TestCheckSnapshot_WithoutShapeMessageKeepsGeneratedText(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints:   map[string][]PropertyConstraint{"App": {{Path: "id", MinCount: intPtr(1)}}},
		IndividualTypes:  map[string][]string{"r1": {"App"}},
		IndividualValues: map[string][]AssertedValue{},
	}
	got := CheckSnapshot(snapshot)
	if len(got) != 1 || got[0].RuleId != "" || got[0].Message != "expected at least 1 value(s) for id, found 0" {
		t.Errorf("CheckSnapshot() = %+v, want empty rule id and the generated message", got)
	}
}

func TestViolationJSONHasNewFieldsAndKeepsOldOnes(t *testing.T) {
	b, err := json.Marshal(Violation{IndividualIri: "i", RuleId: "R", QualityDimension: "Q", ShapeIri: "S"})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"individualIri", "individualLabel", "typeIri", "path", "constraint", "message", "ruleId", "qualityDimension", "shapeIri"} {
		if !strings.Contains(string(b), `"`+key+`"`) {
			t.Errorf("JSON %s lacks %q", b, key)
		}
	}
}

func TestViolationJSON_KeepsAnEmptyValueAndOmitsNone(t *testing.T) {
	empty, blank := "", "  "
	for _, c := range []struct {
		value *string
		want  string
	}{{&empty, `"value":""`}, {&blank, `"value":"  "`}} {
		b, _ := json.Marshal(Violation{Value: c.value})
		if !strings.Contains(string(b), c.want) {
			t.Errorf("JSON %s lacks %s", b, c.want)
		}
	}
	b, _ := json.Marshal(Violation{})
	if strings.Contains(string(b), `"value"`) {
		t.Errorf("JSON %s must omit value when there is none", b)
	}
}

func TestCheckSnapshot_ValueOfEachConstraintKind(t *testing.T) {
	const xsdInteger = "http://www.w3.org/2001/XMLSchema#integer"
	id := func(c PropertyConstraint) PropertyConstraint { c.Path = "id"; return c }
	cases := []struct {
		name       string
		constraint PropertyConstraint
		values     []AssertedValue
		kind       string
		want       *string // nil: no value
	}{
		{"minCount has none", id(PropertyConstraint{MinCount: intPtr(1)}), nil, "minCount", nil},
		{"maxCount has none", id(PropertyConstraint{MaxCount: intPtr(1)}), []AssertedValue{lit("id", "a", ""), lit("id", "b", "")}, "maxCount", nil},
		{"datatype is the found datatype", id(PropertyConstraint{Datatype: "http://www.w3.org/2001/XMLSchema#string"}), []AssertedValue{lit("id", "1005", xsdInteger)}, "datatype", strPtr(xsdInteger)},
		{"minLength is the empty string", id(PropertyConstraint{MinLength: intPtr(1)}), []AssertedValue{lit("id", "", "")}, "minLength", strPtr("")},
		{"pattern is the offending text", id(PropertyConstraint{Pattern: "^[0-9]+$"}), []AssertedValue{lit("id", "1", ""), lit("id", "A-77", "")}, "pattern", strPtr("A-77")},
		{"pattern keeps whitespace", id(PropertyConstraint{Pattern: "^[0-9]+$"}), []AssertedValue{lit("id", "  ", "")}, "pattern", strPtr("  ")},
		{"class is the offending IRI", id(PropertyConstraint{TargetClasses: []string{"Other"}}), []AssertedValue{{Predicate: "id", IsIRI: true, Value: "http://ex#x"}}, "class", strPtr("http://ex#x")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got *Violation
			for _, v := range checkOne(c.constraint, c.values...).Violations {
				if v.Constraint == c.kind {
					got = &v
				}
			}
			if got == nil {
				t.Fatalf("no %s violation", c.kind)
			}
			if (got.Value == nil) != (c.want == nil) || (c.want != nil && *got.Value != *c.want) {
				t.Errorf("Value = %v, want %v", got.Value, c.want)
			}
		})
	}
}

func strPtr(s string) *string { return &s }

func lit(predicate, value, datatype string) AssertedValue {
	return AssertedValue{Predicate: predicate, Value: value, Datatype: datatype}
}

func checkOne(constraint PropertyConstraint, values ...AssertedValue) CheckResult {
	return CheckSnapshotDetailed(ValidationSnapshot{
		OwnConstraints:   map[string][]PropertyConstraint{"App": {constraint}},
		IndividualTypes:  map[string][]string{"r1": {"App"}},
		IndividualValues: map[string][]AssertedValue{"r1": values},
	})
}

func TestCheckSnapshot_PatternAndMinLength(t *testing.T) {
	const xsdInteger = "http://www.w3.org/2001/XMLSchema#integer"
	digits := PropertyConstraint{Path: "id", Pattern: "^[0-9]+$", RuleId: "FORMAT", Message: "not numeric"}
	min1 := PropertyConstraint{Path: "id", MinLength: intPtr(1)}

	cases := []struct {
		name       string
		constraint PropertyConstraint
		values     []AssertedValue
		want       string // "" for no violation, else the constraint kind
	}{
		{"pattern match", digits, []AssertedValue{lit("id", "1001", xsdString)}, ""},
		{"pattern mismatch", digits, []AssertedValue{lit("id", "A-77", xsdString)}, "pattern"},
		{"pattern empty string", digits, []AssertedValue{lit("id", "", xsdString)}, "pattern"},
		{"pattern spaces", digits, []AssertedValue{lit("id", "  ", xsdString)}, "pattern"},
		{"pattern checks lexical form of an integer", digits, []AssertedValue{lit("id", "1005", xsdInteger)}, ""},
		{"pattern checks the IRI string", digits, []AssertedValue{{Predicate: "id", IsIRI: true, Value: "http://x/123"}}, "pattern"},
		{"pattern fails a blank node", digits, []AssertedValue{{Predicate: "id", IsBlank: true, Value: "b0"}}, "pattern"},
		{"pattern without values", digits, nil, ""},
		{"minLength empty string", min1, []AssertedValue{lit("id", "", xsdString)}, "minLength"},
		{"minLength spaces count as length", min1, []AssertedValue{lit("id", "  ", xsdString)}, ""},
		{"minLength integer by lexical form", min1, []AssertedValue{lit("id", "7", xsdInteger)}, ""},
		{"minLength counts characters not bytes", PropertyConstraint{Path: "id", MinLength: intPtr(2)}, []AssertedValue{lit("id", "ä", xsdString)}, "minLength"},
		{"minLength blank node", min1, []AssertedValue{{Predicate: "id", IsBlank: true, Value: "b0"}}, "minLength"},
	}
	for _, c := range cases {
		got := checkOne(c.constraint, c.values...)
		if c.want == "" {
			if len(got.Violations) != 0 {
				t.Errorf("%s: violations = %+v, want none", c.name, got.Violations)
			}
			continue
		}
		if len(got.Violations) != 1 || got.Violations[0].Constraint != c.want {
			t.Errorf("%s: violations = %+v, want one %s", c.name, got.Violations, c.want)
		}
	}
}

func TestCheckSnapshot_PatternFindingCarriesMessageAndRuleId(t *testing.T) {
	got := checkOne(PropertyConstraint{Path: "id", Pattern: "^[0-9]+$", RuleId: "FORMAT", Message: "not numeric"}, lit("id", "x", xsdString))
	if len(got.Violations) != 1 || got.Violations[0].RuleId != "FORMAT" || got.Violations[0].Message != "not numeric" {
		t.Errorf("violations = %+v", got.Violations)
	}
}

func TestCheckSnapshot_OneFindingPerConstraintEvenWithSeveralFailingValues(t *testing.T) {
	got := checkOne(PropertyConstraint{Path: "id", Pattern: "^[0-9]+$"}, lit("id", "a", xsdString), lit("id", "b", xsdString))
	if len(got.Violations) != 1 {
		t.Errorf("violations = %+v, want 1", got.Violations)
	}
}

func TestCheckSnapshot_FlagsApplyToPattern(t *testing.T) {
	got := checkOne(PropertyConstraint{Path: "id", Pattern: "^abc$", Flags: "i"}, lit("id", "ABC", xsdString))
	if len(got.Violations) != 0 || len(got.NotChecked) != 0 {
		t.Errorf("result = %+v, want a match with flag i", got)
	}
}

func TestCheckSnapshot_UncompilablePatternIsNotCheckedNotAFailure(t *testing.T) {
	c := PropertyConstraint{Path: "id", ShapeIri: "http://ns#S", RuleId: "R", Pattern: "^(?=x)$"}
	got := CheckSnapshotDetailed(ValidationSnapshot{
		OwnConstraints:  map[string][]PropertyConstraint{"App": {c}},
		IndividualTypes: map[string][]string{"r1": {"App"}, "r2": {"App"}},
		IndividualValues: map[string][]AssertedValue{
			"r1": {lit("id", "x", xsdString)}, "r2": {lit("id", "y", xsdString)},
		},
	})
	if len(got.Violations) != 0 {
		t.Errorf("violations = %+v, want none", got.Violations)
	}
	if len(got.NotChecked) != 1 || got.NotChecked[0].Construct != "pattern" || got.NotChecked[0].ShapeIri != "http://ns#S" || got.NotChecked[0].RuleId != "R" {
		t.Errorf("notChecked = %+v, want one pattern entry for the shape (deduplicated across individuals)", got.NotChecked)
	}
}

func TestCheckSnapshot_ConstraintsWithoutNewKeysBehaveAsBefore(t *testing.T) {
	got := checkOne(PropertyConstraint{Path: "id", MinCount: intPtr(1)}, lit("id", "", xsdString))
	if len(got.Violations) != 0 || len(got.NotChecked) != 0 {
		t.Errorf("result = %+v, want clean", got)
	}
}
