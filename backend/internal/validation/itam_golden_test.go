package validation

// Exact-set test of the ITAM example (spec/shacl-test STORY-353): the real engine runs over
// testdata/golden/itam-snapshot.json (built from examples/itam-shapes by `bun run shacl:golden`,
// kept fresh by a Vitest spec) and must produce exactly the in-memory findings of
// examples/itam-shapes/itam-expected.json, no missing and no extra. The `sparql` findings of the
// same file are covered by the SPARQL contract test (story 357).

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
)

type expectedFinding struct {
	Individual string  `json:"individual"`
	RuleId     string  `json:"ruleId"`
	Constraint string  `json:"constraint"`
	Path       string  `json:"path"`
	Engine     string  `json:"engine"`
	Value      *string `json:"value"`
}

func (f expectedFinding) key() string {
	return strings.Join([]string{f.Individual, f.RuleId, f.Constraint, f.Path}, " | ")
}

func loadItamSnapshot(t *testing.T) ValidationSnapshot {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/golden/itam-snapshot.json")
	if err != nil {
		t.Fatalf("read golden snapshot: %v", err)
	}
	var snapshot ValidationSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatalf("parse golden snapshot: %v", err)
	}
	return snapshot
}

func loadItamExpected(t *testing.T, engine string) []expectedFinding {
	t.Helper()
	raw, err := os.ReadFile("../../../examples/itam-shapes/itam-expected.json")
	if err != nil {
		t.Fatalf("read expected findings: %v", err)
	}
	var file struct {
		Findings []expectedFinding `json:"findings"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse expected findings: %v", err)
	}
	var out []expectedFinding
	for _, f := range file.Findings {
		if f.Engine == engine {
			out = append(out, f)
		}
	}
	return out
}

// diffFindings returns the expected findings the engine missed and the findings it produced that
// nobody expected, as sorted keys.
func diffFindings(want []expectedFinding, got []Violation) (missing, extra []string) {
	wantSet := map[string]bool{}
	for _, f := range want {
		wantSet[f.key()] = true
	}
	gotSet := map[string]bool{}
	for _, v := range got {
		gotSet[expectedFinding{Individual: v.IndividualIri, RuleId: v.RuleId, Constraint: v.Constraint, Path: v.Path}.key()] = true
	}
	for k := range wantSet {
		if !gotSet[k] {
			missing = append(missing, k)
		}
	}
	for k := range gotSet {
		if !wantSet[k] {
			extra = append(extra, k)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	return missing, extra
}

func TestItamGolden_InMemoryFindingsMatchExpectedExactly(t *testing.T) {
	want := loadItamExpected(t, "inMemory")
	if len(want) != 7 {
		t.Fatalf("expected file lists %d in-memory findings, want 7", len(want))
	}
	result := CheckSnapshotDetailed(loadItamSnapshot(t))
	missing, extra := diffFindings(want, result.Violations)
	if len(missing) > 0 || len(extra) > 0 {
		t.Errorf("missing findings:\n  %s\nextra findings:\n  %s", strings.Join(missing, "\n  "), strings.Join(extra, "\n  "))
	}
	if len(result.NotChecked) != 0 {
		t.Errorf("NotChecked = %+v, want none: every pattern in the ITAM shapes compiles", result.NotChecked)
	}
}

func TestItamGolden_FindingsCarryRuleIdAndGermanMessage(t *testing.T) {
	for _, v := range CheckSnapshot(loadItamSnapshot(t)) {
		if v.RuleId == "" || v.Message == "" || v.QualityDimension == "" || v.ShapeIri == "" {
			t.Errorf("violation lacks shape identity: %+v", v)
		}
	}
}

func TestItamGolden_RemovingThePatternNamesTheMissingFinding(t *testing.T) {
	snapshot := loadItamSnapshot(t)
	for class, constraints := range snapshot.OwnConstraints {
		for i := range constraints {
			constraints[i].Pattern = ""
		}
		snapshot.OwnConstraints[class] = constraints
	}
	missing, extra := diffFindings(loadItamExpected(t, "inMemory"), CheckSnapshot(snapshot))
	if len(extra) != 0 {
		t.Errorf("extra = %v, want none", extra)
	}
	wantMissing := "https://lida.pnet.ch/arm#R14 | AC-TECHID-FORMAT | pattern | https://lida.pnet.ch/arm/schema#A_TECHNICAL_ID"
	found := false
	for _, m := range missing {
		found = found || m == wantMissing
	}
	if !found || len(missing) != 4 {
		t.Errorf("missing = %v, want 4 pattern findings including R14", missing)
	}
}

func valueText(v *string) string {
	if v == nil {
		return "(none)"
	}
	return strconv.Quote(*v)
}

// diffValues lists the findings whose offending value differs from the expected table, keyed like
// diffFindings. Findings missing on either side are diffFindings' business.
func diffValues(want []expectedFinding, got []Violation) []string {
	wantByKey := map[string]*string{}
	for _, f := range want {
		wantByKey[f.key()] = f.Value
	}
	var differs []string
	for _, v := range got {
		key := expectedFinding{Individual: v.IndividualIri, RuleId: v.RuleId, Constraint: v.Constraint, Path: v.Path}.key()
		wantValue, ok := wantByKey[key]
		if !ok {
			continue
		}
		if (wantValue == nil) != (v.Value == nil) || (wantValue != nil && *wantValue != *v.Value) {
			differs = append(differs, fmt.Sprintf("%s: want %s, got %s", key, valueText(wantValue), valueText(v.Value)))
		}
	}
	sort.Strings(differs)
	return differs
}

func TestItamGolden_InMemoryFindingsCarryTheExpectedValue(t *testing.T) {
	got := CheckSnapshot(loadItamSnapshot(t))
	if differs := diffValues(loadItamExpected(t, "inMemory"), got); len(differs) > 0 {
		t.Errorf("values differ:\n  %s", strings.Join(differs, "\n  "))
	}
}
