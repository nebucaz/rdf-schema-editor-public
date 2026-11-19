package validation

import "testing"

const (
	skosNS         = "http://www.w3.org/2004/02/skos/core#"
	skosConcept    = skosNS + "Concept"
	skosCollection = skosNS + "Collection"
	skosPrefLabel  = skosNS + "prefLabel"
	skosDefinition = skosNS + "definition"
	skosInScheme   = skosNS + "inScheme"
	skosMember     = skosNS + "member"
)

// skosShapesSnapshot mirrors the constraints of `app/src/lib/services/skos-shapes.ts` (skos-support
// STORY-413) in the engine's own terms, so the export's shapes are proven to run without a notChecked entry.
func skosShapesSnapshot() ValidationSnapshot {
	one := intPtr(1)
	return ValidationSnapshot{
		OwnConstraints: map[string][]PropertyConstraint{
			skosConcept: {
				{ShapeIri: "urn:shape:Concept", Path: skosPrefLabel, MinCount: one, UniqueLang: true},
				{ShapeIri: "urn:shape:Concept", Path: skosDefinition, MinCount: one},
				{ShapeIri: "urn:shape:Concept", Path: skosInScheme, MinCount: one},
			},
			skosCollection: {
				{ShapeIri: "urn:shape:Collection", Path: skosPrefLabel, MinCount: one, UniqueLang: true},
				{ShapeIri: "urn:shape:Collection", Path: skosMember, TargetClasses: []string{skosConcept, skosCollection}},
			},
		},
		IndividualTypes: map[string][]string{
			"urn:c:good": {skosConcept}, "urn:c:broken": {skosConcept},
			"urn:coll:ok": {skosCollection},
		},
		IndividualValues: map[string][]AssertedValue{
			"urn:c:good": {
				{Predicate: skosPrefLabel, Value: "Employee", Lang: "en", Datatype: rdfLangString},
				{Predicate: skosPrefLabel, Value: "Mitarbeiter", Lang: "de", Datatype: rdfLangString},
				{Predicate: skosDefinition, Value: "A person.", Datatype: xsdString},
				{Predicate: skosInScheme, IsIRI: true, Value: "urn:scheme"},
			},
			"urn:c:broken": {
				{Predicate: skosPrefLabel, Value: "Staff", Lang: "en", Datatype: rdfLangString},
				{Predicate: skosPrefLabel, Value: "Worker", Lang: "en", Datatype: rdfLangString},
				{Predicate: skosInScheme, IsIRI: true, Value: "urn:scheme"},
			},
			"urn:coll:ok": {
				{Predicate: skosPrefLabel, Value: "Roles", Lang: "en", Datatype: rdfLangString},
				{Predicate: skosMember, IsIRI: true, Value: "urn:c:good"},
			},
		},
	}
}

func TestSkosShapes_BrokenConceptYieldsMatchingFindings(t *testing.T) {
	got := CheckSnapshot(skosShapesSnapshot())
	byConstraint := map[string][]string{}
	for _, v := range got {
		byConstraint[v.Constraint] = append(byConstraint[v.Constraint], v.IndividualIri)
	}
	if len(byConstraint["minCount"]) != 1 || byConstraint["minCount"][0] != "urn:c:broken" {
		t.Errorf("minCount findings = %v, want only urn:c:broken (no definition)", byConstraint["minCount"])
	}
	if len(byConstraint["uniqueLang"]) != 1 || byConstraint["uniqueLang"][0] != "urn:c:broken" {
		t.Errorf("uniqueLang findings = %v, want only urn:c:broken (two English prefLabels)", byConstraint["uniqueLang"])
	}
	if len(got) != 2 {
		t.Errorf("CheckSnapshot() = %+v, want exactly the two findings for the broken concept", got)
	}
}

func TestUniqueLang_IgnoresValuesWithoutLanguageAndDifferentLanguages(t *testing.T) {
	snapshot := ValidationSnapshot{
		OwnConstraints:  map[string][]PropertyConstraint{"C": {{Path: "p", UniqueLang: true}}},
		IndividualTypes: map[string][]string{"x": {"C"}},
		IndividualValues: map[string][]AssertedValue{"x": {
			{Predicate: "p", Value: "a", Datatype: xsdString},
			{Predicate: "p", Value: "b", Datatype: xsdString},
			{Predicate: "p", Value: "c", Lang: "en", Datatype: rdfLangString},
			{Predicate: "p", Value: "d", Lang: "de", Datatype: rdfLangString},
		}},
	}
	if got := CheckSnapshot(snapshot); len(got) != 0 {
		t.Errorf("CheckSnapshot() = %+v, want none: untagged literals and distinct languages are fine", got)
	}
}

func TestUniqueLang_IsAnEvaluatedKey(t *testing.T) {
	if !ignoredPropertyKeys[shUniqueLang] {
		t.Error("sh:uniqueLang must be an evaluated key, or the report lists it under notChecked")
	}
}
