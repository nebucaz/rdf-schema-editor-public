package validation

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"
)

var findingIdPattern = regexp.MustCompile(`^[a-z2-7]{16}$`)

func baseViolation() Violation {
	return Violation{
		IndividualIri: "http://ex/i1", TypeIri: "http://ex/T", Path: "http://ex/p", Constraint: "minCount",
		RuleId: "arm-s:r1", ShapeIri: "http://ex/shape",
	}
}

func TestFindingID_FormatAndStability(t *testing.T) {
	v := baseViolation()
	id := FindingID(v)
	if !findingIdPattern.MatchString(id) {
		t.Fatalf("id %q does not match %s", id, findingIdPattern)
	}
	v.Message, v.IndividualLabel, v.QualityDimension = "other", "other label", "other"
	val := "x"
	v.Value = &val
	if got := FindingID(v); got != id {
		t.Errorf("message/label/value changed the id: %q != %q", got, id)
	}
}

func TestFindingID_ChangesWithEachKeyPart(t *testing.T) {
	base := FindingID(baseViolation())
	mutations := map[string]func(*Violation){
		"individual": func(v *Violation) { v.IndividualIri = "http://ex/i2" },
		"type":       func(v *Violation) { v.TypeIri = "http://ex/U" },
		"shape":      func(v *Violation) { v.ShapeIri = "http://ex/other" },
		"path":       func(v *Violation) { v.Path = "http://ex/q" },
		"constraint": func(v *Violation) { v.Constraint = "maxCount" },
	}
	for name, mutate := range mutations {
		v := baseViolation()
		mutate(&v)
		if FindingID(v) == base {
			t.Errorf("changing %s did not change the id", name)
		}
	}
}

func TestFindingID_RuleIdFallbackWhenNoShape(t *testing.T) {
	a := baseViolation()
	a.ShapeIri = ""
	b := a
	b.RuleId = "arm-s:r2"
	if FindingID(a) == FindingID(b) {
		t.Error("ruleId must distinguish findings when the shape IRI is empty")
	}
	c := baseViolation()
	c.RuleId = "arm-s:changed"
	if FindingID(c) != FindingID(baseViolation()) {
		t.Error("ruleId must not matter when a shape IRI is present")
	}
}

func TestFindingID_SeparatorPreventsAmbiguity(t *testing.T) {
	a := baseViolation()
	a.IndividualIri, a.TypeIri = "ab", "c"
	b := baseViolation()
	b.IndividualIri, b.TypeIri = "a", "bc"
	if FindingID(a) == FindingID(b) {
		t.Error("field boundaries are ambiguous")
	}
}

func TestCheckAll_AssignsIDsToEveryViolation(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	result := CheckAll(t.Context(), newItamCannedRunner(t, snapshot), snapshot)
	if len(result.Violations) == 0 {
		t.Fatal("no violations")
	}
	for _, v := range result.Violations {
		if v.ID == "" || v.ID != FindingID(v) {
			t.Errorf("violation %s/%s has id %q", v.IndividualIri, v.Constraint, v.ID)
		}
	}
}

func TestViolationJSON_IncludesID(t *testing.T) {
	v := baseViolation()
	v.ID = FindingID(v)
	raw, _ := json.Marshal(v)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	if m["id"] != v.ID {
		t.Errorf("json id = %v", m["id"])
	}
}

// The golden fixture is shared with the frontend (spec/validation-issues-tracker STORY-381): the
// backend derives, the frontend only checks the shape.
func TestFindingID_GoldenVectors(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/golden/finding-id.json")
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var file struct {
		Vectors []struct {
			Name      string    `json:"name"`
			Violation Violation `json:"violation"`
			ID        string    `json:"id"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Vectors) < 3 {
		t.Fatalf("only %d vectors", len(file.Vectors))
	}
	for _, vec := range file.Vectors {
		if got := FindingID(vec.Violation); got != vec.ID {
			t.Errorf("%s: id = %s, want %s", vec.Name, got, vec.ID)
		}
	}
}

func TestCheckAll_ItamIDsAreUniquePerFinding(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	result := CheckAll(t.Context(), newItamCannedRunner(t, snapshot), snapshot)
	seen := map[string]Violation{}
	for _, v := range result.Violations {
		if prev, dup := seen[v.ID]; dup {
			t.Errorf("id %s shared by %s/%s/%s and %s/%s/%s", v.ID, prev.IndividualIri, prev.RuleId, prev.Constraint, v.IndividualIri, v.RuleId, v.Constraint)
		}
		seen[v.ID] = v
	}
}
