package sync

import (
	"context"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
)

// seedSourceRelation declares propIRI's `rse:sourceRelation` mapping — mirrors seedSourceField.
func seedSourceRelation(store *graphdbtest.Store, vocab Vocabulary, propIRI, relationType string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: propIRI, P: vocab.SourceRelationPredicateIRI, O: relationType, ObjectIsIRI: false,
	})
}

// seedSyncSourceRef declares individualIRI's `rse:syncSourceRef` marker — mirrors what
// `mergeWriteOps` itself writes, used here to seed "a prior run already synced this target" state
// directly, without going through a full RunSync call.
func seedSyncSourceRef(store *graphdbtest.Store, vocab Vocabulary, graph, individualIRI, sourceRef string) {
	store.Seed(graphdbtest.Triple{
		Graph: graph, S: individualIRI, P: vocab.SyncSourceRefPredicateIRI, O: sourceRef, ObjectIsIRI: false,
	})
}

func TestResolveSourceRelationMapping_IncludesProperlyScopedExcludesUnattached(t *testing.T) {
	engine, store := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"
	otherClassIRI := "http://ld.example.org/schema#Api"
	scopedProp := "http://ld.example.org/schema#ownedBy"
	unattachedProp := "http://ld.example.org/schema#apiOnlyRelation"

	seedSourceRelation(store, engine.vocab, scopedProp, "ownedBy")
	seedPropertyShape(store, classIRI, scopedProp, "http://ld.example.org/shapes#ownedBy", false)

	seedSourceRelation(store, engine.vocab, unattachedProp, "providesApi")
	seedPropertyShape(store, otherClassIRI, unattachedProp, "http://ld.example.org/shapes#apiOnlyRelation", false)

	mapping, err := engine.resolveSourceRelationMapping(context.Background(), classIRI)
	if err != nil {
		t.Fatalf("resolveSourceRelationMapping() error = %v", err)
	}
	if got, ok := mapping["ownedBy"]; !ok || got != scopedProp {
		t.Errorf("mapping[ownedBy] = %q, ok=%v, want %q, true", got, ok, scopedProp)
	}
	if _, ok := mapping["providesApi"]; ok {
		t.Errorf("mapping should exclude providesApi (attached to a different class's shape): %v", mapping)
	}
}

func TestResolveSourceRelationMapping_NoSourceRelationTriplesReturnsEmpty(t *testing.T) {
	engine, _ := newTestEngine(t)
	classIRI := "http://ld.example.org/schema#Component"

	mapping, err := engine.resolveSourceRelationMapping(context.Background(), classIRI)
	if err != nil {
		t.Fatalf("resolveSourceRelationMapping() error = %v", err)
	}
	if len(mapping) != 0 {
		t.Errorf("mapping = %v, want empty", mapping)
	}
}

func TestResolveSyncSourceRefTarget_FindsMarkedIndividualAcrossGraphs(t *testing.T) {
	engine, store := newTestEngine(t)
	wantIRI := "http://ld.example.org/backstage#backstage-team-1"
	seedSyncSourceRef(store, engine.vocab, "http://ld.example.org/backstage", wantIRI, "group:default/payments-team")

	got, err := engine.resolveSyncSourceRefTarget(context.Background(), "group:default/payments-team")
	if err != nil {
		t.Fatalf("resolveSyncSourceRefTarget() error = %v", err)
	}
	if got != wantIRI {
		t.Errorf("resolveSyncSourceRefTarget() = %q, want %q", got, wantIRI)
	}
}

func TestResolveSyncSourceRefTarget_NoMatchReturnsEmpty(t *testing.T) {
	engine, _ := newTestEngine(t)

	got, err := engine.resolveSyncSourceRefTarget(context.Background(), "group:default/unknown-team")
	if err != nil {
		t.Fatalf("resolveSyncSourceRefTarget() error = %v", err)
	}
	if got != "" {
		t.Errorf("resolveSyncSourceRefTarget() = %q, want empty for no match", got)
	}
}
