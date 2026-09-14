package validation

import (
	"reflect"
	"sort"
	"testing"
)

func intPtr(n int) *int { return &n }

func pathsOf(constraints []PropertyConstraint) []string {
	paths := make([]string, len(constraints))
	for i, c := range constraints {
		paths[i] = c.Path
	}
	sort.Strings(paths)
	return paths
}

func TestEffectiveShape_SingleClassNoAncestry(t *testing.T) {
	own := map[string][]PropertyConstraint{
		"Person": {{Path: "name", MinCount: intPtr(1)}},
	}
	got := EffectiveShape("Person", own, map[string][]string{})
	if !reflect.DeepEqual(pathsOf(got), []string{"name"}) {
		t.Errorf("EffectiveShape() paths = %v, want [name]", pathsOf(got))
	}
}

func TestEffectiveShape_OneLevelInheritance(t *testing.T) {
	own := map[string][]PropertyConstraint{
		"Employee": {{Path: "salary", MinCount: intPtr(1)}},
		"Person":   {{Path: "name", MinCount: intPtr(1)}},
	}
	subClassOf := map[string][]string{"Employee": {"Person"}}

	got := EffectiveShape("Employee", own, subClassOf)
	if !reflect.DeepEqual(pathsOf(got), []string{"name", "salary"}) {
		t.Errorf("EffectiveShape() paths = %v, want [name salary]", pathsOf(got))
	}
}

func TestEffectiveShape_MultiLevelChain(t *testing.T) {
	own := map[string][]PropertyConstraint{
		"Manager":  {{Path: "reports", MinCount: intPtr(0)}},
		"Employee": {{Path: "salary", MinCount: intPtr(1)}},
		"Person":   {{Path: "name", MinCount: intPtr(1)}},
	}
	subClassOf := map[string][]string{
		"Manager":  {"Employee"},
		"Employee": {"Person"},
	}

	got := EffectiveShape("Manager", own, subClassOf)
	if !reflect.DeepEqual(pathsOf(got), []string{"name", "reports", "salary"}) {
		t.Errorf("EffectiveShape() paths = %v, want [name reports salary]", pathsOf(got))
	}
}

func TestEffectiveShape_DiamondInheritanceNoDoubleCount(t *testing.T) {
	// D -> B -> A, D -> C -> A: A's constraint must appear exactly once.
	own := map[string][]PropertyConstraint{
		"A": {{Path: "id", MinCount: intPtr(1)}},
	}
	subClassOf := map[string][]string{
		"D": {"B", "C"},
		"B": {"A"},
		"C": {"A"},
	}

	got := EffectiveShape("D", own, subClassOf)
	count := 0
	for _, c := range got {
		if c.Path == "id" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("EffectiveShape() contains %d entries for path %q, want exactly 1 (diamond must not double-count)", count, "id")
	}
}

func TestEffectiveShape_ConflictingCardinality_NearestWins(t *testing.T) {
	own := map[string][]PropertyConstraint{
		"Employee": {{Path: "email", MinCount: intPtr(1), MaxCount: intPtr(1)}},
		"Person":   {{Path: "email", MinCount: intPtr(0)}},
	}
	subClassOf := map[string][]string{"Employee": {"Person"}}

	got := EffectiveShape("Employee", own, subClassOf)
	if len(got) != 1 {
		t.Fatalf("EffectiveShape() returned %d constraints for shadowed path %q, want 1", len(got), "email")
	}
	if got[0].MinCount == nil || *got[0].MinCount != 1 {
		t.Errorf("EffectiveShape() email.MinCount = %v, want the subclass's own (nearest) value 1", got[0].MinCount)
	}
	if got[0].MaxCount == nil || *got[0].MaxCount != 1 {
		t.Errorf("EffectiveShape() email.MaxCount = %v, want the subclass's own (nearest) value 1", got[0].MaxCount)
	}
}

func TestEffectiveShape_ConflictingCardinality_NearestAncestorWinsOverFartherAncestor(t *testing.T) {
	own := map[string][]PropertyConstraint{
		"GrandParent": {{Path: "code", MinCount: intPtr(0)}},
		"Parent":      {{Path: "code", MinCount: intPtr(1)}},
	}
	subClassOf := map[string][]string{
		"Child":  {"Parent"},
		"Parent": {"GrandParent"},
	}

	got := EffectiveShape("Child", own, subClassOf)
	if len(got) != 1 || got[0].MinCount == nil || *got[0].MinCount != 1 {
		t.Errorf("EffectiveShape() = %+v, want the nearer ancestor Parent's MinCount 1 to win over GrandParent's", got)
	}
}

func TestEffectiveShape_NoShapeAtAllResolvesEmpty(t *testing.T) {
	got := EffectiveShape("Orphan", map[string][]PropertyConstraint{}, map[string][]string{})
	if len(got) != 0 {
		t.Errorf("EffectiveShape() = %v, want empty for a class with no shape and no ancestry", got)
	}
}

func TestIsClassOrAncestor(t *testing.T) {
	subClassOf := map[string][]string{
		"Manager":  {"Employee"},
		"Employee": {"Person"},
	}

	if !isClassOrAncestor("Manager", "Manager", subClassOf) {
		t.Error("isClassOrAncestor() = false for exact type match, want true")
	}
	if !isClassOrAncestor("Manager", "Person", subClassOf) {
		t.Error("isClassOrAncestor() = false for transitive ancestor, want true")
	}
	if isClassOrAncestor("Manager", "Vehicle", subClassOf) {
		t.Error("isClassOrAncestor() = true for unrelated class, want false")
	}
}
