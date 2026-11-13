package validation

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
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
	// RuleId, QualityDimension and ShapeIri name the shape that produced the finding (empty when the
	// shape has no `arm-s:id`/`arm-s:qualityDimension`); Message is the shape's own `sh:message`
	// when it has one, else the generated text.
	RuleId           string `json:"ruleId"`
	QualityDimension string `json:"qualityDimension"`
	ShapeIri         string `json:"shapeIri"`
	// Value is the offending value: a pointer, because "" and "  " are real values and must stay
	// distinguishable from none (minCount, maxCount, or a sh:sparql row without ?value). It is not
	// part of the finding key (individual, ruleId, path, constraint).
	Value *string `json:"value,omitempty"`
}

// CheckSnapshot checks every individual in snapshot against the effective (own + inherited) shape
// of every one of its declared `rdf:type`s, per the closed constraint vocabulary this app ever
// writes: sh:minCount, sh:maxCount, sh:datatype, and sh:class (a plain sh:class or an sh:or union of
// sh:class options — PropertyConstraint.TargetClasses holds one or the other uniformly, and both are
// checked identically: "does at least one of the value's declared types, or one of their
// rdfs:subClassOf ancestors, appear in TargetClasses").
func CheckSnapshot(snapshot ValidationSnapshot) []Violation {
	return CheckSnapshotDetailed(snapshot).Violations
}

// NotChecked names a constraint the engine could not evaluate (for example a `sh:pattern` that
// Go's RE2 cannot compile). It is never a violation; the report shows it so nothing is skipped
// silently.
type NotChecked struct {
	ShapeIri  string `json:"shapeIri"`
	RuleId    string `json:"ruleId"`
	Construct string `json:"construct"`
	Reason    string `json:"reason"`
}

// CheckResult is what a run produced: the violations and the constraints it could not check.
type CheckResult struct {
	Violations []Violation
	NotChecked []NotChecked
}

// checkRun holds the per-run state shared by all checks: compiled patterns and the not-checked list.
type checkRun struct {
	patterns   map[string]*regexp.Regexp // key: flags + "\x00" + pattern; nil entry = uncompilable
	notChecked []NotChecked
	reported   map[NotChecked]bool
}

// pattern compiles pattern with the SHACL flags it supports (i, s, m); ok is false, and the
// constraint recorded as not checked once, when it cannot be compiled.
func (r *checkRun) pattern(c PropertyConstraint) (*regexp.Regexp, bool) {
	key := c.Flags + "\x00" + c.Pattern
	re, cached := r.patterns[key]
	if !cached {
		prefix := ""
		var err error
		for _, f := range c.Flags {
			if f != 'i' && f != 's' && f != 'm' {
				err = fmt.Errorf("unsupported sh:flags %q", string(f))
				break
			}
		}
		if err == nil {
			if c.Flags != "" {
				prefix = "(?" + c.Flags + ")"
			}
			re, err = regexp.Compile(prefix + c.Pattern)
		}
		if err != nil {
			re = nil
			entry := NotChecked{ShapeIri: c.ShapeIri, RuleId: c.RuleId, Construct: "pattern", Reason: err.Error()}
			if !r.reported[entry] {
				r.reported[entry] = true
				r.notChecked = append(r.notChecked, entry)
			}
		}
		r.patterns[key] = re
	}
	return re, re != nil
}

// CheckSnapshotDetailed is CheckSnapshot plus the list of constraints that could not be checked.
func CheckSnapshotDetailed(snapshot ValidationSnapshot) CheckResult {
	run := &checkRun{patterns: map[string]*regexp.Regexp{}, reported: map[NotChecked]bool{}, notChecked: append([]NotChecked(nil), snapshot.NotChecked...)}
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
				violations = append(violations, checkConstraint(run, individual, label, typeIri, constraint, values, snapshot)...)
			}
		}
	}
	return CheckResult{Violations: violations, NotChecked: run.notChecked}
}

// checkConstraint runs the one applicable check for constraint (a PropertyConstraint may carry
// cardinality, a datatype, and/or target classes at once, e.g. `sh:minCount 1 ; sh:class <c>` on
// the same sh:property — each populated field is checked independently) and returns 0 or more
// Violations, per (individual, typeIri, path, constraint-kind).
func checkConstraint(run *checkRun, individual, label, typeIri string, constraint PropertyConstraint, values []AssertedValue, snapshot ValidationSnapshot) []Violation {
	var matching []AssertedValue
	for _, v := range values {
		if v.Predicate == constraint.Path {
			matching = append(matching, v)
		}
	}

	var violations []Violation
	newViolation := func(kind, generated string, value *string) Violation {
		message := generated
		if constraint.Message != "" {
			message = constraint.Message
		}
		return Violation{
			IndividualIri: individual, IndividualLabel: label, TypeIri: typeIri, Path: constraint.Path,
			Constraint: kind, Message: message,
			RuleId: constraint.RuleId, QualityDimension: constraint.QualityDimension, ShapeIri: constraint.ShapeIri,
			Value: value,
		}
	}

	if constraint.MinCount != nil && len(matching) < *constraint.MinCount {
		violations = append(violations, newViolation("minCount", fmt.Sprintf("expected at least %d value(s) for %s, found %d", *constraint.MinCount, constraint.Path, len(matching)), nil))
	}

	if constraint.MaxCount != nil && len(matching) > *constraint.MaxCount {
		violations = append(violations, newViolation("maxCount", fmt.Sprintf("expected at most %d value(s) for %s, found %d", *constraint.MaxCount, constraint.Path, len(matching)), nil))
	}

	if constraint.Datatype != "" {
		for _, v := range matching {
			if !v.IsIRI && v.Datatype != constraint.Datatype {
				violations = append(violations, newViolation("datatype", fmt.Sprintf("expected datatype %s for %s, found %s", constraint.Datatype, constraint.Path, v.Datatype), &v.Datatype))
				break
			}
		}
	}

	if constraint.MinLength != nil {
		for _, v := range matching {
			if v.IsBlank || utf8.RuneCountInString(v.Value) < *constraint.MinLength {
				violations = append(violations, newViolation("minLength", fmt.Sprintf("expected at least %d character(s) for %s", *constraint.MinLength, constraint.Path), &v.Value))
				break
			}
		}
	}

	if constraint.Pattern != "" {
		if re, ok := run.pattern(constraint); ok {
			for _, v := range matching {
				if v.IsBlank || !re.MatchString(v.Value) {
					violations = append(violations, newViolation("pattern", fmt.Sprintf("expected %s to match pattern %s", constraint.Path, constraint.Pattern), &v.Value))
					break
				}
			}
		}
	}

	if len(constraint.TargetClasses) > 0 {
		for _, v := range matching {
			if !v.IsIRI {
				continue
			}
			if !matchesAnyTargetClass(v.Value, constraint.TargetClasses, snapshot) {
				violations = append(violations, newViolation("class", fmt.Sprintf("expected %s to be of type %s for %s", v.Value, strings.Join(constraint.TargetClasses, " or "), constraint.Path), &v.Value))
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

// CheckAll is the whole report: the in-memory checks plus the guarded `sh:sparql` constraints, run
// through runner one constraint after another. The findings are merged and ordered by individual,
// then rule id (the in-memory order within an individual is kept). Constraints that could not be
// checked are returned in NotChecked. A repository without `sh:sparql` shapes runs no extra query.
func CheckAll(ctx context.Context, runner SelectRunner, snapshot ValidationSnapshot) CheckResult {
	result := CheckSnapshotDetailed(snapshot)
	violations, notChecked := CheckSparql(ctx, runner, snapshot)
	if len(violations) > 0 {
		result.Violations = append(result.Violations, violations...)
		sort.SliceStable(result.Violations, func(i, j int) bool {
			a, b := result.Violations[i], result.Violations[j]
			if a.IndividualIri != b.IndividualIri {
				return a.IndividualIri < b.IndividualIri
			}
			return a.RuleId < b.RuleId
		})
	}
	result.NotChecked = append(result.NotChecked, notChecked...)
	return result
}

// CheckSparql runs every loaded `sh:sparql` constraint for the individuals typed with its target
// class (or a subclass), sequentially, and returns the findings ordered by individual and rule id.
// A constraint that fails to run becomes a NotChecked entry; the others still run.
func CheckSparql(ctx context.Context, runner SelectRunner, snapshot ValidationSnapshot) ([]Violation, []NotChecked) {
	if len(snapshot.SparqlConstraints) == 0 {
		return nil, nil
	}
	individuals := make([]string, 0, len(snapshot.IndividualTypes))
	for individual := range snapshot.IndividualTypes {
		individuals = append(individuals, individual)
	}
	sort.Strings(individuals)

	var violations []Violation
	var notChecked []NotChecked
	for _, c := range snapshot.SparqlConstraints {
		matchingType := map[string]string{}
		var focus []string
		for _, individual := range individuals {
			for _, typeIri := range snapshot.IndividualTypes[individual] {
				if isClassOrAncestor(typeIri, c.TargetClass, snapshot.SubClassOf) {
					matchingType[individual] = typeIri
					focus = append(focus, individual)
					break
				}
			}
		}
		if len(focus) == 0 {
			continue
		}
		rows, skipped := RunSparqlConstraint(ctx, runner, c, focus, DefaultSparqlLimits)
		if skipped != nil {
			notChecked = append(notChecked, *skipped)
			continue
		}
		seen := map[SparqlRow]bool{}
		for _, row := range rows {
			typeIri, inFocus := matchingType[row.This]
			if !inFocus || seen[row] {
				continue
			}
			seen[row] = true
			label := individualLabel(row.This, snapshot.IndividualValues[row.This])
			violations = append(violations, newSparqlViolation(c, row, typeIri, label))
		}
	}
	sort.SliceStable(violations, func(i, j int) bool {
		a, b := violations[i], violations[j]
		if a.IndividualIri != b.IndividualIri {
			return a.IndividualIri < b.IndividualIri
		}
		return a.RuleId < b.RuleId
	})
	return violations, notChecked
}
