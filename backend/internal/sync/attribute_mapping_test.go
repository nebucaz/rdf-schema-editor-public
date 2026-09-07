package sync

import (
	"context"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
)

// seedSourceField declares propIRI's `rse:sourceField` mapping — mirrors seedMapping/seedNamespace.
func seedSourceField(store *graphdbtest.Store, vocab Vocabulary, propIRI, path string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: propIRI, P: vocab.SourceFieldPredicateIRI, O: path, ObjectIsIRI: false,
	})
}

// seedPropertyShape declares propIRI as `sh:property`'d (via a blank-node-shaped propShape IRI)
// onto classIRI's `sh:NodeShape` — repeatable unless maxCountOne is true.
func seedPropertyShape(store *graphdbtest.Store, classIRI, propIRI, propShapeIRI string, maxCountOne bool) {
	shapeIRI := propShapeIRI + "Shape"
	store.Seed(
		graphdbtest.Triple{Graph: "http://ld.example.org/shapes", S: shapeIRI, P: shTargetClass, O: classIRI, ObjectIsIRI: true},
		graphdbtest.Triple{Graph: "http://ld.example.org/shapes", S: shapeIRI, P: shProperty, O: propShapeIRI, ObjectIsIRI: true},
		graphdbtest.Triple{Graph: "http://ld.example.org/shapes", S: propShapeIRI, P: shPath, O: propIRI, ObjectIsIRI: true},
	)
	if maxCountOne {
		store.Seed(graphdbtest.Triple{Graph: "http://ld.example.org/shapes", S: propShapeIRI, P: shMaxCount, O: "1", ObjectIsIRI: false})
	}
}

// seedPropertyShapeClass declares propShapeIRI's `sh:class` range constraint (STORY-105) — used
// alongside seedPropertyShape to give the represents-predicate's shape entry a required target
// class `resolveRepresentsTarget`'s type-match ASK checks against.
func seedPropertyShapeClass(store *graphdbtest.Store, propShapeIRI, targetClass string) {
	store.Seed(graphdbtest.Triple{Graph: "http://ld.example.org/shapes", S: propShapeIRI, P: shClass, O: targetClass, ObjectIsIRI: true})
}

func TestResolveSourceFieldMapping_IncludesProperlyScopedExcludesUnattached(t *testing.T) {
	engine, store := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"
	otherClassIRI := "http://ld.example.org/schema#Api"
	scopedProp := "http://ld.example.org/schema#componentType"
	unattachedProp := "http://ld.example.org/schema#apiOnlyField"

	seedSourceField(store, engine.vocab, scopedProp, "spec.type")
	seedPropertyShape(store, classIRI, scopedProp, "http://ld.example.org/shapes#componentType", false)

	seedSourceField(store, engine.vocab, unattachedProp, "spec.other")
	seedPropertyShape(store, otherClassIRI, unattachedProp, "http://ld.example.org/shapes#apiOnlyField", false)

	mapping, err := engine.resolveSourceFieldMapping(context.Background(), classIRI)
	if err != nil {
		t.Fatalf("resolveSourceFieldMapping() error = %v", err)
	}
	got, ok := mapping[scopedProp]
	if !ok {
		t.Fatalf("mapping missing properly-scoped property %s: %v", scopedProp, mapping)
	}
	if got.Path != "spec.type" {
		t.Errorf("mapping[%s].Path = %q, want %q", scopedProp, got.Path, "spec.type")
	}
	if !got.Repeatable {
		t.Errorf("mapping[%s].Repeatable = false, want true (no sh:maxCount)", scopedProp)
	}
	if _, ok := mapping[unattachedProp]; ok {
		t.Errorf("mapping should exclude %s (attached to a different class's shape)", unattachedProp)
	}
}

func TestResolveSourceFieldMapping_MaxCountOneIsNotRepeatable(t *testing.T) {
	engine, store := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"
	prop := "http://ld.example.org/schema#componentType"
	seedSourceField(store, engine.vocab, prop, "spec.type")
	seedPropertyShape(store, classIRI, prop, "http://ld.example.org/shapes#componentType", true)

	mapping, err := engine.resolveSourceFieldMapping(context.Background(), classIRI)
	if err != nil {
		t.Fatalf("resolveSourceFieldMapping() error = %v", err)
	}
	if mapping[prop].Repeatable {
		t.Error("Repeatable = true, want false (sh:maxCount 1 declared)")
	}
}

func TestResolveSourceFieldMapping_NoSourceFieldTriplesReturnsEmpty(t *testing.T) {
	engine, _ := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"

	mapping, err := engine.resolveSourceFieldMapping(context.Background(), classIRI)
	if err != nil {
		t.Fatalf("resolveSourceFieldMapping() error = %v", err)
	}
	if len(mapping) != 0 {
		t.Errorf("mapping = %v, want empty", mapping)
	}
}

func TestResolveRepresentsTarget_MalformedAnnotationIsSkippedAndReported(t *testing.T) {
	engine, store := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"
	representsPredicateIRI := "http://ld.example.org/schema#represents"
	propShapeIRI := "http://ld.example.org/shapes#represents"
	seedPropertyShape(store, classIRI, representsPredicateIRI, propShapeIRI, false)
	seedPropertyShapeClass(store, propShapeIRI, "http://ld.example.org/core-schema#Application")

	// A SPARQL-unsafe annotation value (an embedded space breaks the IRIREF grammar) must never be
	// interpolated into the type-check ASK query — rejected up front instead.
	entity := entityWithAnnotation("abc-1", "Payments API", "http://ld.example.org/core#has space", nil)

	targetIRI, failure, err := engine.resolveRepresentsTarget(context.Background(), classIRI, representsPredicateIRI, entity)
	if err != nil {
		t.Fatalf("resolveRepresentsTarget() error = %v", err)
	}
	if targetIRI != "" {
		t.Errorf("targetIRI = %q, want empty for a malformed annotation", targetIRI)
	}
	if failure == "" {
		t.Error("expected a non-empty failure message for a malformed annotation")
	}
}

func TestResolveRepresentsTarget_NoAnnotationReturnsNoFailure(t *testing.T) {
	engine, _ := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"
	representsPredicateIRI := "http://ld.example.org/schema#represents"
	entity := Entity{UID: "abc-1", Name: "Payments API"}

	targetIRI, failure, err := engine.resolveRepresentsTarget(context.Background(), classIRI, representsPredicateIRI, entity)
	if err != nil {
		t.Fatalf("resolveRepresentsTarget() error = %v", err)
	}
	if targetIRI != "" || failure != "" {
		t.Errorf("targetIRI = %q, failure = %q, want both empty for a missing annotation", targetIRI, failure)
	}
}
