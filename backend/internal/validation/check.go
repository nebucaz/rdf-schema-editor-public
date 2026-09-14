package validation

import (
	"fmt"
	"sort"
	"strings"
)

// Violation is one failing SHACL constraint against one individual, under one of its declared
// types (plan.md's "flat list, one row per (individualIri, typeIri, path, constraint) violation —
// no dedup across types" ADR: a multi-typed identity failing the same path under two of its types
// produces two separate Violation rows here, not one).
type Violation struct {
	IndividualIri   string `json:"individualIri"`
	IndividualLabel string `json:"individualLabel"`
	TypeIri         string `json:"typeIri"`
	Path            string `json:"path"`
	Constraint      string `json:"constraint"`
	Message         string `json:"message"`
}

// CheckSnapshot checks every individual in snapshot against the effective (own + inherited) shape
// of every one of its declared `rdf:type`s, per the closed constraint vocabulary this app ever
// writes: sh:minCount, sh:maxCount, sh:datatype, and sh:class (a plain sh:class or an sh:or union of
// sh:class options — PropertyConstraint.TargetClasses holds one or the other uniformly, and both are
// checked identically: "does at least one of the value's declared types, or one of their
// rdfs:subClassOf ancestors, appear in TargetClasses").
func CheckSnapshot(snapshot ValidationSnapshot) []Violation {
	shapeCache := make(map[string][]PropertyConstraint)
	effectiveShape := func(classIri string) []PropertyConstraint {
		if cached, ok := shapeCache[classIri]; ok {
			return cached
		}
		shape := EffectiveShape(classIri, snapshot.OwnConstraints, snapshot.SubClassOf)
		shapeCache[classIri] = shape
		return shape
	}

	individuals := make([]string, 0, len(snapshot.IndividualTypes))
	for individual := range snapshot.IndividualTypes {
		individuals = append(individuals, individual)
	}
	sort.Strings(individuals)

	var violations []Violation
	for _, individual := range individuals {
		values := snapshot.IndividualValues[individual]
		label := individualLabel(individual, values)

		for _, typeIri := range snapshot.IndividualTypes[individual] {
			for _, constraint := range effectiveShape(typeIri) {
				violations = append(violations, checkConstraint(individual, label, typeIri, constraint, values, snapshot)...)
			}
		}
	}
	return violations
}

// checkConstraint runs the one applicable check for constraint (a PropertyConstraint may carry
// cardinality, a datatype, and/or target classes at once, e.g. `sh:minCount 1 ; sh:class <c>` on
// the same sh:property — each populated field is checked independently) and returns 0 or more
// Violations, per (individual, typeIri, path, constraint-kind).
func checkConstraint(individual, label, typeIri string, constraint PropertyConstraint, values []AssertedValue, snapshot ValidationSnapshot) []Violation {
	var matching []AssertedValue
	for _, v := range values {
		if v.Predicate == constraint.Path {
			matching = append(matching, v)
		}
	}

	var violations []Violation

	if constraint.MinCount != nil && len(matching) < *constraint.MinCount {
		violations = append(violations, Violation{
			IndividualIri: individual, IndividualLabel: label, TypeIri: typeIri, Path: constraint.Path,
			Constraint: "minCount",
			Message:    fmt.Sprintf("expected at least %d value(s) for %s, found %d", *constraint.MinCount, constraint.Path, len(matching)),
		})
	}

	if constraint.MaxCount != nil && len(matching) > *constraint.MaxCount {
		violations = append(violations, Violation{
			IndividualIri: individual, IndividualLabel: label, TypeIri: typeIri, Path: constraint.Path,
			Constraint: "maxCount",
			Message:    fmt.Sprintf("expected at most %d value(s) for %s, found %d", *constraint.MaxCount, constraint.Path, len(matching)),
		})
	}

	if constraint.Datatype != "" {
		for _, v := range matching {
			if !v.IsIRI && v.Datatype != constraint.Datatype {
				violations = append(violations, Violation{
					IndividualIri: individual, IndividualLabel: label, TypeIri: typeIri, Path: constraint.Path,
					Constraint: "datatype",
					Message:    fmt.Sprintf("expected datatype %s for %s, found %s", constraint.Datatype, constraint.Path, v.Datatype),
				})
				break
			}
		}
	}

	if len(constraint.TargetClasses) > 0 {
		for _, v := range matching {
			if !v.IsIRI {
				continue
			}
			if !matchesAnyTargetClass(v.Value, constraint.TargetClasses, snapshot) {
				violations = append(violations, Violation{
					IndividualIri: individual, IndividualLabel: label, TypeIri: typeIri, Path: constraint.Path,
					Constraint: "class",
					Message:    fmt.Sprintf("expected %s to be of type %s for %s", v.Value, strings.Join(constraint.TargetClasses, " or "), constraint.Path),
				})
				break
			}
		}
	}

	return violations
}

// matchesAnyTargetClass reports whether valueIri's declared type(s) — or any of their
// rdfs:subClassOf ancestors — include at least one of targetClasses. A value with no recorded type
// (e.g. an IRI referencing something outside this validation run's individual set) never matches.
func matchesAnyTargetClass(valueIri string, targetClasses []string, snapshot ValidationSnapshot) bool {
	for _, valueType := range snapshot.IndividualTypes[valueIri] {
		for _, target := range targetClasses {
			if isClassOrAncestor(valueType, target, snapshot.SubClassOf) {
				return true
			}
		}
	}
	return false
}

// individualLabel returns individual's own rdfs:label value if it asserted one, else the IRI's
// local name (the fragment after '#', or the last '/'-segment) — mirrors
// app/src/lib/utils/iri.ts's extractLocalName fallback used throughout the TS side for the same
// "no explicit label" case.
func individualLabel(individual string, values []AssertedValue) string {
	for _, v := range values {
		if v.Predicate == rdfsLabel && !v.IsIRI {
			return v.Value
		}
	}
	if i := strings.LastIndexByte(individual, '#'); i >= 0 {
		return individual[i+1:]
	}
	if i := strings.LastIndexByte(individual, '/'); i >= 0 {
		return individual[i+1:]
	}
	return individual
}
