package validation

import "testing"

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
