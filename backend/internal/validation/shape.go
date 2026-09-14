package validation

// PropertyConstraint is one `sh:property` entry's resolved constraint (STORY-127): the constrained
// predicate `Path` (including `rdfs:label` for the shape-required-label case), optional cardinality,
// an optional `sh:datatype`, and `TargetClasses` — the `sh:class` union this path may point at,
// holding one entry for a plain `sh:class` and 2+ entries for an `sh:or` union of `sh:class`
// options (STORY-129 treats both shapes identically: "is the value's type-or-ancestor in this
// list").
type PropertyConstraint struct {
	Path          string
	MinCount      *int
	MaxCount      *int
	Datatype      string
	TargetClasses []string
}

// EffectiveShape resolves classIri's own `sh:property` constraints (ownConstraints[classIri])
// merged with every ancestor class's own constraints, walking `rdfs:subClassOf` transitively via
// subClassOf (sub -> its direct superclasses).
//
// Shadowing is by `Path`, "nearest wins": classIri's own constraint for a given path always wins
// over any ancestor's, and among ancestors the nearest one (fewest `rdfs:subClassOf` hops) to
// declare that path wins over a farther one — the same precedence rule
// `app/src/lib/services/canvas-model.ts`'s `mergeAncestorAttributes`/`mergeAncestorRelations` use
// on the TS side (there shadowing by attribute/relation *name*; here by shape `Path`), reimplemented
// independently per plan.md's ADR rather than shared.
//
// Diamond inheritance (a class reachable via two different ancestor paths) is handled by
// orderedAncestors' visited-set BFS: each ancestor is visited (and so contributes constraints) at
// most once, at its nearest distance from classIri.
//
// A class with no `rdfs:subClassOf` edges and no `sh:NodeShape` of its own resolves to an empty
// (nil) slice, not an error.
func EffectiveShape(classIri string, ownConstraints map[string][]PropertyConstraint, subClassOf map[string][]string) []PropertyConstraint {
	own := ownConstraints[classIri]
	seen := make(map[string]bool, len(own))
	for _, c := range own {
		seen[c.Path] = true
	}

	result := append([]PropertyConstraint(nil), own...)
	for _, ancestor := range orderedAncestors(classIri, subClassOf) {
		for _, c := range ownConstraints[ancestor] {
			if seen[c.Path] {
				continue
			}
			seen[c.Path] = true
			result = append(result, c)
		}
	}
	return result
}

// orderedAncestors returns classIri's transitive `rdfs:subClassOf` ancestors, nearest first, as a
// plain in-memory BFS over subClassOf (sub -> its direct superclasses) — the Go-side mirror of
// canvas-model.ts's own `orderedAncestors` helper, same visited-set diamond-inheritance guard.
func orderedAncestors(classIri string, subClassOf map[string][]string) []string {
	visited := make(map[string]bool)
	var order []string
	frontier := subClassOf[classIri]
	for len(frontier) > 0 {
		var next []string
		for _, parent := range frontier {
			if visited[parent] {
				continue
			}
			visited[parent] = true
			order = append(order, parent)
			next = append(next, subClassOf[parent]...)
		}
		frontier = next
	}
	return order
}

// isClassOrAncestor reports whether typeIri itself is targetClass, or targetClass is one of
// typeIri's transitive `rdfs:subClassOf` ancestors — the "value's type-or-ancestor" walk STORY-129's
// `sh:class`/`sh:or` check needs, over the same subClassOf graph EffectiveShape uses but in the
// opposite direction of intent (here: does this concrete type satisfy that shape target; there:
// what constraints does this class inherit).
func isClassOrAncestor(typeIri, targetClass string, subClassOf map[string][]string) bool {
	if typeIri == targetClass {
		return true
	}
	for _, ancestor := range orderedAncestors(typeIri, subClassOf) {
		if ancestor == targetClass {
			return true
		}
	}
	return false
}
