package sync

import (
	"context"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
)

// entityWithFields is a small fixtureSource.entities builder for STORY-101 tests, avoiding
// repeated Entity{...} literals across cases below.
func entityWithFields(uid, name string, fields map[string]string, fieldLists map[string][]string) Entity {
	return Entity{UID: uid, Name: name, Fields: fields, FieldLists: fieldLists}
}

// fixtureSource is an in-test Source returning whatever kinds/entities a test configures — mirrors
// handler package's own fakeSource, kept package-local here since sync's own tests need finer
// control per-call (mutable entity sets across successive RunSync calls, for re-run/staleness tests).
type fixtureSource struct {
	name     string
	kinds    []string
	entities map[string][]Entity
}

func (f *fixtureSource) Name() string { return f.name }

func (f *fixtureSource) DiscoverKinds(ctx context.Context) ([]string, error) {
	return f.kinds, nil
}

func (f *fixtureSource) FetchEntities(ctx context.Context, kind string) ([]Entity, error) {
	return f.entities[kind], nil
}

func testVocab() Vocabulary {
	cfg := config.Config{SchemaNamespace: "http://ld.example.org/schema#"}
	return Vocabulary{
		DefaultNamespaceBaseIRI:       cfg.DefaultNamespaceBaseIRI(),
		BackstageKindPredicateIRI:     cfg.BackstageKindPredicateIRI(),
		SyncSourcePredicateIRI:        cfg.SyncSourcePredicateIRI(),
		SyncStatusPredicateIRI:        cfg.SyncStatusPredicateIRI(),
		NamespaceClassIRI:             cfg.NamespaceClassIRI(),
		NamespacePrefixIRI:            cfg.NamespacePrefixPredicateIRI(),
		NamespacePredicateIRI:         cfg.NamespacePredicateIRI(),
		SourceFieldPredicateIRI:       cfg.SourceFieldPredicateIRI(),
		AppSettingsIRI:                cfg.AppSettingsIRI(),
		RepresentsPredicateSettingIRI: cfg.RepresentsPredicateSettingIRI(),
		SourceRelationPredicateIRI:    cfg.SourceRelationPredicateIRI(),
		SyncSourceRefPredicateIRI:     cfg.SyncSourceRefPredicateIRI(),
	}
}

const testClassIRI = "http://ld.example.org/schema#Application"

// testNamespaceBaseIRI is the Concept Namespace every pre-STORY-099 test seeds its mapped class into
// — deliberately the same value the old fixed per-source namespace used to resolve to
// (`sourceNamespaceBaseIRI(cfg.DefaultNamespaceBaseIRI(), "backstage")`), so every pre-existing
// `wantIRI`/graph assertion in this file keeps holding unchanged after the STORY-099 restructuring.
const testNamespaceBaseIRI = "http://ld.example.org/backstage"

func seedMapping(store *graphdbtest.Store, vocab Vocabulary, kind, classIRI string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: classIRI, P: vocab.BackstageKindPredicateIRI, O: kind, ObjectIsIRI: false,
	})
}

// seedNamespace declares classIRI's own `rse:namespace` (STORY-099) — required for `RunSync` to sync
// any instances of classIRI at all now that a class with no resolvable Namespace anywhere in its
// `rdfs:subClassOf*` ancestry is skipped.
func seedNamespace(store *graphdbtest.Store, vocab Vocabulary, classIRI, namespaceBaseIRI string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: classIRI, P: vocab.NamespacePredicateIRI, O: namespaceBaseIRI, ObjectIsIRI: true,
	})
}

// seedSubClassOf declares subIRI `rdfs:subClassOf` superIRI — used by the STORY-099 ancestry-walk
// tests below.
func seedSubClassOf(store *graphdbtest.Store, subIRI, superIRI string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: subIRI, P: rdfsSubClassOf, O: superIRI, ObjectIsIRI: true,
	})
}

// seedRepresentsPredicateSetting declares the STORY-103 `<AppSettingsIRI> <RepresentsPredicateSettingIRI>
// <predicateIRI>` setting triple — an unset setting (this helper simply not called) is what
// `TestRunSync_RepresentsSkippedWhenSettingUnset` exercises.
func seedRepresentsPredicateSetting(store *graphdbtest.Store, vocab Vocabulary, predicateIRI string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: vocab.AppSettingsIRI, P: vocab.RepresentsPredicateSettingIRI, O: predicateIRI, ObjectIsIRI: true,
	})
}

// entityWithAnnotation is entityWithFields' STORY-105 sibling — seeds the one fixed
// `enterpriseCatalogIRIAnnotationKey` field a `represents` link resolves from, alongside any other
// ordinary fields a test case needs.
func entityWithAnnotation(uid, name, annotationIRI string, extraFields map[string]string) Entity {
	fields := map[string]string{enterpriseCatalogIRIAnnotationKey: annotationIRI}
	for k, v := range extraFields {
		fields[k] = v
	}
	return Entity{UID: uid, Name: name, Fields: fields}
}

func newTestEngine(t *testing.T) (*Engine, *graphdbtest.Store) {
	t.Helper()
	server, store := graphdbtest.NewServer()
	t.Cleanup(server.Close)
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	return NewEngine(gdb, testVocab()), store
}

func TestRunSync_MintsDeterministicIRIsAndSkipsUnmapped(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Domain"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if summary.SkippedKinds[0] != "Domain" {
		t.Errorf("SkippedKinds = %v, want [Domain]", summary.SkippedKinds)
	}
	if summary.SyncedPerKind["Component"] != 1 {
		t.Errorf("SyncedPerKind[Component] = %d, want 1", summary.SyncedPerKind["Component"])
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, rdfType, testClassIRI, true) {
		t.Errorf("expected deterministic individual IRI %s to exist with rdf:type %s", wantIRI, testClassIRI)
	}
	if !store.Has("http://ld.example.org/backstage", wantIRI, rdfsLabel, "Payments API", false) {
		t.Error("expected rdfs:label to be written")
	}
	if !store.Has("http://ld.example.org/backstage", wantIRI, engine.vocab.SyncSourcePredicateIRI, "backstage", false) {
		t.Error("expected rse:syncSource marker to be written")
	}
}

func TestRunSync_RerunIsIdempotent(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("first RunSync() error = %v", err)
	}
	firstCount := len(store.Snapshot())

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("second RunSync() error = %v", err)
	}
	secondCount := len(store.Snapshot())

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	occurrences := 0
	for _, tr := range store.Snapshot() {
		if tr.S == wantIRI && tr.P == rdfType {
			occurrences++
		}
	}
	if occurrences != 1 {
		t.Errorf("rdf:type triple count for the individual = %d, want exactly 1 (no duplicate minting)", occurrences)
	}

	// A fresh prov:Activity (3 triples: rdf:type/startedAtTime/endedAtTime) is legitimately minted
	// per run — that's the only thing that should grow the overall triple count across an
	// otherwise-idempotent re-run against unchanged fixture data.
	if want := firstCount + 3; secondCount != want {
		t.Errorf("triple count = %d after re-run, want %d (first run's %d + one fresh Activity's 3 triples)", secondCount, want, firstCount)
	}

	activityCount := store.CountMatching("http://ld.example.org/backstage", wantIRI, provWasGeneratedBy)
	if activityCount != 1 {
		t.Errorf("wasGeneratedBy count = %d, want exactly 1 (fresh per run, not accumulated)", activityCount)
	}

	systemOfWorkCount := store.CountMatching("http://ld.example.org/backstage", "http://ld.example.org/backstage#Backstage", rdfType)
	if systemOfWorkCount != 1 {
		t.Errorf("SystemOfWork rdf:type count = %d, want exactly 1 (bootstrap must not repeat)", systemOfWorkCount)
	}
}

func TestRunSync_HumanAddedTripleSurvivesResync(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	humanPredicate := "http://ld.example.org/schema#isMasterForOverride"
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/backstage", S: wantIRI, P: humanPredicate, O: "http://example.org/SomeSystem", ObjectIsIRI: true,
	})

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("second RunSync() error = %v", err)
	}

	if !store.Has("http://ld.example.org/backstage", wantIRI, humanPredicate, "http://example.org/SomeSystem", true) {
		t.Error("human-added triple did not survive a re-sync")
	}
}

func TestRunSync_SystemOfWorkBootstrapAndIsMasterFor(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	seedMapping(store, engine.vocab, "System", "http://ld.example.org/schema#System")
	seedNamespace(store, engine.vocab, "http://ld.example.org/schema#System", testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "System"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
			"System":    {}, // mapped, but zero instances found this run
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("first RunSync() error = %v", err)
	}

	systemOfWorkIRI := "http://ld.example.org/backstage#Backstage"
	systemOfWorkClass := "http://ld.example.org/backstage/schema#SystemOfWork"
	if !store.Has("http://ld.example.org/backstage", systemOfWorkIRI, rdfType, systemOfWorkClass, true) {
		t.Error("expected Backstage SystemOfWork individual to be bootstrapped")
	}

	isMasterForIRI := "http://ld.example.org/backstage/schema#isMasterFor"
	if !store.Has("http://ld.example.org/backstage", systemOfWorkIRI, isMasterForIRI, testClassIRI, true) {
		t.Error("expected isMasterFor asserted for Component (had a synced instance)")
	}
	if store.Has("http://ld.example.org/backstage", systemOfWorkIRI, isMasterForIRI, "http://ld.example.org/schema#System", true) {
		t.Error("isMasterFor must not be asserted for System (zero synced instances this run)")
	}

	// Run again: SystemOfWork individual must not be duplicated.
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("second RunSync() error = %v", err)
	}
	count := store.CountMatching("http://ld.example.org/backstage", systemOfWorkIRI, rdfType)
	if count != 1 {
		t.Errorf("SystemOfWork rdf:type triple count = %d, want exactly 1 across two runs", count)
	}
}

func TestRunSync_DryRunIsSideEffectFree(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}

	before := store.Snapshot()
	summary, err := engine.RunSync(context.Background(), source, true)
	if err != nil {
		t.Fatalf("RunSync(dryRun) error = %v", err)
	}
	after := store.Snapshot()

	if len(before) != len(after) {
		t.Fatalf("triple count changed across a dry run: %d -> %d", len(before), len(after))
	}
	if !summary.DryRun {
		t.Error("summary.DryRun = false, want true")
	}
	if summary.SyncedPerKind["Component"] != 1 {
		t.Errorf("dry-run summary SyncedPerKind[Component] = %d, want 1 (reads still run)", summary.SyncedPerKind["Component"])
	}
}

func TestRunSync_DryRunSummaryMatchesRealRun(t *testing.T) {
	engineDry, storeDry := newTestEngine(t)
	seedMapping(storeDry, engineDry.vocab, "Component", testClassIRI)
	seedNamespace(storeDry, engineDry.vocab, testClassIRI, testNamespaceBaseIRI)
	sourceDry := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Domain"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}
	dryRunSummary, err := engineDry.RunSync(context.Background(), sourceDry, true)
	if err != nil {
		t.Fatalf("dry RunSync() error = %v", err)
	}

	engineReal, storeReal := newTestEngine(t)
	seedMapping(storeReal, engineReal.vocab, "Component", testClassIRI)
	seedNamespace(storeReal, engineReal.vocab, testClassIRI, testNamespaceBaseIRI)
	sourceReal := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Domain"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}
	realSummary, err := engineReal.RunSync(context.Background(), sourceReal, false)
	if err != nil {
		t.Fatalf("real RunSync() error = %v", err)
	}

	if dryRunSummary.SyncedPerKind["Component"] != realSummary.SyncedPerKind["Component"] {
		t.Errorf("SyncedPerKind mismatch: dry=%v real=%v", dryRunSummary.SyncedPerKind, realSummary.SyncedPerKind)
	}
	if len(dryRunSummary.SkippedKinds) != len(realSummary.SkippedKinds) {
		t.Errorf("SkippedKinds mismatch: dry=%v real=%v", dryRunSummary.SkippedKinds, realSummary.SkippedKinds)
	}
	if dryRunSummary.Mapping["Component"] != realSummary.Mapping["Component"] {
		t.Errorf("Mapping mismatch: dry=%v real=%v", dryRunSummary.Mapping, realSummary.Mapping)
	}
}

func TestRunSync_ConcurrentRealSyncRejected(t *testing.T) {
	engine, _ := newTestEngine(t)
	source := &fixtureSource{name: "backstage", kinds: []string{}}

	engine.mu.Lock()
	engine.inFlight["backstage"] = true
	engine.mu.Unlock()

	if _, err := engine.RunSync(context.Background(), source, false); err != ErrSyncInProgress {
		t.Errorf("RunSync() error = %v, want ErrSyncInProgress", err)
	}

	// A dry run must never be blocked by an in-flight real sync.
	if _, err := engine.RunSync(context.Background(), source, true); err != nil {
		t.Errorf("dry-run RunSync() during in-flight real sync error = %v, want nil", err)
	}
}

// -- Story 009: staleness handling ------------------------------------------------------------

func TestRunSync_StalenessFlagsDisappearedEntity(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {
				{UID: "abc-1", Name: "Payments API", Kind: "Component"},
				{UID: "abc-2", Name: "Billing API", Kind: "Component"},
			},
		},
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}

	// run 2: abc-2 disappears upstream
	source.entities["Component"] = []Entity{{UID: "abc-1", Name: "Payments API", Kind: "Component"}}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}

	staleIRI := "http://ld.example.org/backstage#backstage-abc-2"
	if !store.Has("http://ld.example.org/backstage", staleIRI, engine.vocab.SyncStatusPredicateIRI, "stale", false) {
		t.Error("expected disappeared individual to be flagged rse:syncStatus \"stale\"")
	}
	// Its other data (rdf:type/label) must survive untouched.
	if !store.Has("http://ld.example.org/backstage", staleIRI, rdfType, testClassIRI, true) {
		t.Error("stale individual lost its rdf:type triple, should be untouched")
	}
	if !store.Has("http://ld.example.org/backstage", staleIRI, rdfsLabel, "Billing API", false) {
		t.Error("stale individual lost its rdfs:label triple, should be untouched")
	}

	// The still-present individual must never be flagged stale.
	liveIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.Has("http://ld.example.org/backstage", liveIRI, engine.vocab.SyncStatusPredicateIRI, "stale", false) {
		t.Error("live individual must not be flagged stale")
	}
}

func TestRunSync_StaleIndividualReappearsAndClearsFlag(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}, {UID: "abc-2", Name: "Billing API", Kind: "Component"}},
		},
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}

	source.entities["Component"] = []Entity{{UID: "abc-1", Name: "Payments API", Kind: "Component"}}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}

	source.entities["Component"] = []Entity{
		{UID: "abc-1", Name: "Payments API", Kind: "Component"},
		{UID: "abc-2", Name: "Billing API", Kind: "Component"},
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 3 error = %v", err)
	}

	reappearedIRI := "http://ld.example.org/backstage#backstage-abc-2"
	if store.Has("http://ld.example.org/backstage", reappearedIRI, engine.vocab.SyncStatusPredicateIRI, "stale", false) {
		t.Error("reappeared individual should have its stale flag cleared")
	}
}

func TestRunSync_StalenessNeverDeletesCoreTriples(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}
	source.entities["Component"] = nil
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}

	staleIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", staleIRI, rdfType, testClassIRI, true) {
		t.Error("staleness path deleted the individual's own rdf:type — it must never hard-delete")
	}
}

// -- STORY-099: per-Concept Namespace resolution --------------------------------------------------

func TestResolveConceptNamespace_OwnDeclarationWinsOverInherited(t *testing.T) {
	engine, store := newTestEngine(t)
	coreConcept := "http://ld.example.org/schema#CoreConcept"
	shadowClass := "http://ld.example.org/schema#Api"
	seedSubClassOf(store, shadowClass, coreConcept)
	seedNamespace(store, engine.vocab, coreConcept, "http://ld.example.org/inherited")
	seedNamespace(store, engine.vocab, shadowClass, "http://ld.example.org/own")

	ns, err := engine.resolveConceptNamespace(context.Background(), shadowClass)
	if err != nil {
		t.Fatalf("resolveConceptNamespace() error = %v", err)
	}
	if ns != "http://ld.example.org/own" {
		t.Errorf("resolved namespace = %q, want own declaration %q", ns, "http://ld.example.org/own")
	}
}

func TestResolveConceptNamespace_FallsBackToAncestor(t *testing.T) {
	engine, store := newTestEngine(t)
	coreConcept := "http://ld.example.org/schema#CoreConcept"
	shadowClass := "http://ld.example.org/schema#Api"
	seedSubClassOf(store, shadowClass, coreConcept)
	seedNamespace(store, engine.vocab, coreConcept, "http://ld.example.org/inherited")

	ns, err := engine.resolveConceptNamespace(context.Background(), shadowClass)
	if err != nil {
		t.Fatalf("resolveConceptNamespace() error = %v", err)
	}
	if ns != "http://ld.example.org/inherited" {
		t.Errorf("resolved namespace = %q, want inherited %q", ns, "http://ld.example.org/inherited")
	}
}

func TestResolveConceptNamespace_NoneAnywhereReturnsEmpty(t *testing.T) {
	engine, store := newTestEngine(t)
	coreConcept := "http://ld.example.org/schema#CoreConcept"
	shadowClass := "http://ld.example.org/schema#Api"
	seedSubClassOf(store, shadowClass, coreConcept)
	// no rse:namespace declared anywhere in the ancestry.

	ns, err := engine.resolveConceptNamespace(context.Background(), shadowClass)
	if err != nil {
		t.Fatalf("resolveConceptNamespace() error = %v", err)
	}
	if ns != "" {
		t.Errorf("resolved namespace = %q, want empty (no valid Namespace)", ns)
	}
}

func TestRunSync_KindWithNoValidNamespaceIsSkipped(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	// deliberately no seedNamespace call — testClassIRI has no rse:namespace anywhere.
	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.SkippedKinds) != 1 || summary.SkippedKinds[0] != "Component" {
		t.Errorf("SkippedKinds = %v, want [Component] (no valid Namespace)", summary.SkippedKinds)
	}
	if summary.SyncedPerKind["Component"] != 0 {
		t.Errorf("SyncedPerKind[Component] = %d, want 0 (nothing synced without a valid Namespace)", summary.SyncedPerKind["Component"])
	}
}

func TestRunSync_TwoMappedKindsWriteToDifferentNamespaceGraphs(t *testing.T) {
	engine, store := newTestEngine(t)
	componentClassIRI := testClassIRI
	systemClassIRI := "http://ld.example.org/schema#System"
	seedMapping(store, engine.vocab, "Component", componentClassIRI)
	seedMapping(store, engine.vocab, "System", systemClassIRI)
	seedNamespace(store, engine.vocab, componentClassIRI, "http://ld.example.org/ns-a")
	seedNamespace(store, engine.vocab, systemClassIRI, "http://ld.example.org/ns-b")

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "System"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component"}},
			"System":    {{UID: "sys-1", Name: "Core System", Kind: "System"}},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}

	componentIRI := "http://ld.example.org/ns-a#backstage-abc-1"
	systemIRI := "http://ld.example.org/ns-b#backstage-sys-1"
	if !store.Has("http://ld.example.org/ns-a", componentIRI, rdfType, componentClassIRI, true) {
		t.Error("expected Component individual in ns-a's own graph")
	}
	if !store.Has("http://ld.example.org/ns-b", systemIRI, rdfType, systemClassIRI, true) {
		t.Error("expected System individual in ns-b's own graph")
	}
	if store.Has("http://ld.example.org/ns-a", systemIRI, rdfType, systemClassIRI, true) {
		t.Error("System individual must not land in ns-a's graph")
	}
}

// -- STORY-101: property mapping fetch & merge-write integration ------------------------------

func TestRunSync_MappedScalarFieldWritesToIndividual(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	prop := "http://ld.example.org/schema#componentType"
	seedSourceField(store, engine.vocab, prop, "spec.type")
	seedPropertyShape(store, testClassIRI, prop, "http://ld.example.org/shapes#componentType", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithFields("abc-1", "Payments API", map[string]string{"spec.type": "service"}, nil)},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, prop, "service", false) {
		t.Error("expected mapped scalar field to be written")
	}
}

func TestRunSync_MappedArrayFieldAgainstRepeatablePropertyWritesMultipleTriples(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	prop := "http://ld.example.org/schema#tags"
	seedSourceField(store, engine.vocab, prop, "spec.tags")
	seedPropertyShape(store, testClassIRI, prop, "http://ld.example.org/shapes#tags", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithFields("abc-1", "Payments API", nil, map[string][]string{"spec.tags": {"payments", "critical"}})},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, prop, "payments", false) {
		t.Error("expected first tag triple to be written")
	}
	if !store.Has("http://ld.example.org/backstage", wantIRI, prop, "critical", false) {
		t.Error("expected second tag triple to be written")
	}
}

func TestRunSync_MappedArrayAgainstNonRepeatablePropertyIsSkippedAndReported(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	prop := "http://ld.example.org/schema#tags"
	seedSourceField(store, engine.vocab, prop, "spec.tags")
	seedPropertyShape(store, testClassIRI, prop, "http://ld.example.org/shapes#tags", true) // sh:maxCount 1

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithFields("abc-1", "Payments API", nil, map[string][]string{"spec.tags": {"payments", "critical"}})},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.MappingFailures) != 1 {
		t.Fatalf("MappingFailures = %v, want exactly 1", summary.MappingFailures)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, prop) != 0 {
		t.Error("expected no triples for the non-repeatable/array-value mismatch")
	}
}

func TestRunSync_MappedFieldClearedOnNextRunWhenAbsent(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	prop := "http://ld.example.org/schema#componentType"
	seedSourceField(store, engine.vocab, prop, "spec.type")
	seedPropertyShape(store, testClassIRI, prop, "http://ld.example.org/shapes#componentType", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithFields("abc-1", "Payments API", map[string]string{"spec.type": "service"}, nil)},
		},
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, prop, "service", false) {
		t.Fatal("expected mapped field to be written on first run")
	}

	// run 2: the field disappears from the upstream entity.
	source.entities["Component"] = []Entity{entityWithFields("abc-1", "Payments API", map[string]string{}, nil)}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, prop) != 0 {
		t.Error("expected mapped field to be cleared once absent from a later run")
	}
}

func TestRunSync_UnattachedSourceFieldPropertyIsNeverWritten(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	prop := "http://ld.example.org/schema#apiOnlyField"
	otherClassIRI := "http://ld.example.org/schema#Api"
	seedSourceField(store, engine.vocab, prop, "spec.other")
	seedPropertyShape(store, otherClassIRI, prop, "http://ld.example.org/shapes#apiOnlyField", false) // scoped to a different class

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithFields("abc-1", "Payments API", map[string]string{"spec.other": "should-not-land"}, nil)},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, prop) != 0 {
		t.Error("expected a property scoped to a different class's shape to never be written")
	}
}

// -- represents-link resolution (Backstage-sync STORY-105) --------------------------------------

func TestRunSync_RepresentsLinkWrittenWhenAnnotationValid(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	representsPredicateIRI := "http://ld.example.org/schema#represents"
	businessClassIRI := "http://ld.example.org/core-schema#Application"
	businessIndividualIRI := "http://ld.example.org/core#App-123"
	seedRepresentsPredicateSetting(store, engine.vocab, representsPredicateIRI)
	propShapeIRI := "http://ld.example.org/shapes#represents"
	seedPropertyShape(store, testClassIRI, representsPredicateIRI, propShapeIRI, false)
	seedPropertyShapeClass(store, propShapeIRI, businessClassIRI)
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/core", S: businessIndividualIRI, P: rdfType, O: businessClassIRI, ObjectIsIRI: true,
	})

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithAnnotation("abc-1", "Payments API", businessIndividualIRI, nil)},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.RepresentsFailures) != 0 {
		t.Errorf("RepresentsFailures = %v, want none", summary.RepresentsFailures)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, representsPredicateIRI, businessIndividualIRI, true) {
		t.Error("expected represents triple to be written using the configured predicate")
	}
	if summary.RepresentsSynced != 1 {
		t.Errorf("RepresentsSynced = %d, want 1", summary.RepresentsSynced)
	}
}

func TestRunSync_RepresentsSkippedWhenSettingUnset(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	// deliberately no seedRepresentsPredicateSetting call — the setting is left unset.

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithAnnotation("abc-1", "Payments API", "http://ld.example.org/core#App-123", nil)},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.RepresentsFailures) != 0 {
		t.Errorf("RepresentsFailures = %v, want none (an unset setting is not a failure)", summary.RepresentsFailures)
	}
	if summary.RepresentsSynced != 0 {
		t.Errorf("RepresentsSynced = %d, want 0 (setting unset)", summary.RepresentsSynced)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, rdfType, testClassIRI, true) {
		t.Error("expected the shadow individual to still be synced")
	}
}

func TestRunSync_RepresentsSkippedWhenAnnotationMissing(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	representsPredicateIRI := "http://ld.example.org/schema#represents"
	seedRepresentsPredicateSetting(store, engine.vocab, representsPredicateIRI)
	propShapeIRI := "http://ld.example.org/shapes#represents"
	seedPropertyShape(store, testClassIRI, representsPredicateIRI, propShapeIRI, false)
	seedPropertyShapeClass(store, propShapeIRI, "http://ld.example.org/core-schema#Application")

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{UID: "abc-1", Name: "Payments API"}}, // no annotation field at all
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.RepresentsFailures) != 0 {
		t.Errorf("RepresentsFailures = %v, want none (a missing annotation is not a failure)", summary.RepresentsFailures)
	}
	if summary.RepresentsSynced != 0 {
		t.Errorf("RepresentsSynced = %d, want 0 (no annotation)", summary.RepresentsSynced)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, representsPredicateIRI) != 0 {
		t.Error("expected no represents triple when the annotation is absent")
	}
}

func TestRunSync_RepresentsSkippedAndReportedWhenNoShapeEntry(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	representsPredicateIRI := "http://ld.example.org/schema#represents"
	seedRepresentsPredicateSetting(store, engine.vocab, representsPredicateIRI)
	// deliberately no seedPropertyShape/seedPropertyShapeClass call — testClassIRI's own shape never
	// `sh:property`'s representsPredicateIRI at all.

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithAnnotation("abc-1", "Payments API", "http://ld.example.org/core#App-123", nil)},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.RepresentsFailures) != 1 {
		t.Fatalf("RepresentsFailures = %v, want exactly 1", summary.RepresentsFailures)
	}
	if summary.RepresentsSynced != 0 {
		t.Errorf("RepresentsSynced = %d, want 0 (no shape entry)", summary.RepresentsSynced)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, rdfType, testClassIRI, true) {
		t.Error("expected the shadow individual to still be synced despite the represents failure")
	}
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, representsPredicateIRI) != 0 {
		t.Error("expected no represents triple when no shape entry exists")
	}
}

func TestRunSync_RepresentsSkippedAndReportedWhenTargetUnresolvable(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	representsPredicateIRI := "http://ld.example.org/schema#represents"
	businessClassIRI := "http://ld.example.org/core-schema#Application"
	seedRepresentsPredicateSetting(store, engine.vocab, representsPredicateIRI)
	propShapeIRI := "http://ld.example.org/shapes#represents"
	seedPropertyShape(store, testClassIRI, representsPredicateIRI, propShapeIRI, false)
	seedPropertyShapeClass(store, propShapeIRI, businessClassIRI)
	// The annotation IRI is never seeded with any rdf:type at all — plan.md's "or the IRI resolving
	// to nothing at all" clause, same skip path as a genuine type mismatch.
	annotationIRI := "http://ld.example.org/core#DoesNotExist"

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithAnnotation("abc-1", "Payments API", annotationIRI, nil)},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.RepresentsFailures) != 1 {
		t.Fatalf("RepresentsFailures = %v, want exactly 1", summary.RepresentsFailures)
	}
	if summary.RepresentsSynced != 0 {
		t.Errorf("RepresentsSynced = %d, want 0 (unresolvable target)", summary.RepresentsSynced)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, representsPredicateIRI) != 0 {
		t.Error("expected no represents triple for an unresolvable target")
	}
}

func TestRunSync_RepresentsClearedOnNextRunWhenAnnotationInvalidated(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)

	representsPredicateIRI := "http://ld.example.org/schema#represents"
	businessClassIRI := "http://ld.example.org/core-schema#Application"
	businessIndividualIRI := "http://ld.example.org/core#App-123"
	seedRepresentsPredicateSetting(store, engine.vocab, representsPredicateIRI)
	propShapeIRI := "http://ld.example.org/shapes#represents"
	seedPropertyShape(store, testClassIRI, representsPredicateIRI, propShapeIRI, false)
	seedPropertyShapeClass(store, propShapeIRI, businessClassIRI)
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/core", S: businessIndividualIRI, P: rdfType, O: businessClassIRI, ObjectIsIRI: true,
	})

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {entityWithAnnotation("abc-1", "Payments API", businessIndividualIRI, nil)},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}

	wantIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if !store.Has("http://ld.example.org/backstage", wantIRI, representsPredicateIRI, businessIndividualIRI, true) {
		t.Fatal("expected represents triple to be written on first run")
	}

	// run 2: the annotation disappears from the upstream entity.
	source.entities["Component"] = []Entity{{UID: "abc-1", Name: "Payments API"}}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}
	if store.CountMatching("http://ld.example.org/backstage", wantIRI, representsPredicateIRI) != 0 {
		t.Error("expected represents triple to be cleared once the annotation disappears")
	}
}

// -- STORY-106: shadow-to-shadow relation mapping & target resolution -------------------------

func TestRunSync_RelationEdgeWrittenBetweenTwoShadowIndividualsSyncedSameRun(t *testing.T) {
	engine, store := newTestEngine(t)
	componentClassIRI := testClassIRI
	groupClassIRI := "http://ld.example.org/schema#Group"
	seedMapping(store, engine.vocab, "Component", componentClassIRI)
	seedMapping(store, engine.vocab, "Group", groupClassIRI)
	seedNamespace(store, engine.vocab, componentClassIRI, testNamespaceBaseIRI)
	seedNamespace(store, engine.vocab, groupClassIRI, testNamespaceBaseIRI)

	ownedByProp := "http://ld.example.org/schema#ownedBy"
	seedSourceRelation(store, engine.vocab, ownedByProp, "ownedBy")
	seedPropertyShape(store, componentClassIRI, ownedByProp, "http://ld.example.org/shapes#ownedBy", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Group"},
		entities: map[string][]Entity{
			"Component": {{
				UID: "abc-1", Name: "Payments API", Kind: "Component",
				Relations: []Relation{{Type: "ownedBy", TargetRef: "group:default/payments-team"}},
			}},
			"Group": {{UID: "team-1", Name: "Payments Team", Kind: "Group", SourceRef: "group:default/payments-team"}},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.SkippedRelations) != 0 {
		t.Errorf("SkippedRelations = %v, want none", summary.SkippedRelations)
	}
	if summary.RelationsSynced != 1 {
		t.Errorf("RelationsSynced = %d, want 1", summary.RelationsSynced)
	}

	componentIRI := "http://ld.example.org/backstage#backstage-abc-1"
	groupIRI := "http://ld.example.org/backstage#backstage-team-1"
	if !store.Has("http://ld.example.org/backstage", componentIRI, ownedByProp, groupIRI, true) {
		t.Error("expected ownedBy edge from the Component individual to the Group individual, both synced this run")
	}
	if !store.Has("http://ld.example.org/backstage", groupIRI, engine.vocab.SyncSourceRefPredicateIRI, "group:default/payments-team", false) {
		t.Error("expected the Group individual's own rse:syncSourceRef marker to be written")
	}
}

func TestRunSync_UnmappedRelationTypeIsSkippedAndReported(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	// Deliberately no rse:sourceRelation mapping seeded for "ownedBy".

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{
				UID: "abc-1", Name: "Payments API", Kind: "Component",
				Relations: []Relation{{Type: "ownedBy", TargetRef: "group:default/payments-team"}},
			}},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.SkippedRelations) != 1 {
		t.Fatalf("SkippedRelations = %v, want exactly 1 entry", summary.SkippedRelations)
	}
	if summary.RelationsSynced != 0 {
		t.Errorf("RelationsSynced = %d, want 0 (unmapped relation type)", summary.RelationsSynced)
	}

	componentIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", componentIRI, "http://ld.example.org/schema#ownedBy") != 0 {
		t.Error("expected no edge written for an unmapped relation type")
	}
}

func TestRunSync_RelationTargetNotFoundThisRunIsSkippedAndReported(t *testing.T) {
	engine, store := newTestEngine(t)
	seedMapping(store, engine.vocab, "Component", testClassIRI)
	seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
	ownedByProp := "http://ld.example.org/schema#ownedBy"
	seedSourceRelation(store, engine.vocab, ownedByProp, "ownedBy")
	seedPropertyShape(store, testClassIRI, ownedByProp, "http://ld.example.org/shapes#ownedBy", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]Entity{
			"Component": {{
				UID: "abc-1", Name: "Payments API", Kind: "Component",
				Relations: []Relation{{Type: "ownedBy", TargetRef: "group:default/payments-team"}},
			}},
		},
	}

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("RunSync() error = %v", err)
	}
	if len(summary.SkippedRelations) != 1 {
		t.Fatalf("SkippedRelations = %v, want exactly 1 entry", summary.SkippedRelations)
	}
	if summary.RelationsSynced != 0 {
		t.Errorf("RelationsSynced = %d, want 0 (target not synced yet)", summary.RelationsSynced)
	}

	componentIRI := "http://ld.example.org/backstage#backstage-abc-1"
	if store.CountMatching("http://ld.example.org/backstage", componentIRI, ownedByProp) != 0 {
		t.Error("expected no edge written when the relation target isn't synced this run")
	}
}

// TestRunSync_RelationTargetRetriedOnLaterRun proves STORY-106's retry posture end to end: a
// relation whose target isn't found on the run where it's first seen resolves automatically, with
// no separate recovery mechanism, once that target is actually synced on a later run — including the
// fallback path (`Engine.resolveSyncSourceRefTarget`'s GraphDB lookup, not the in-run
// `sourceRefToIndividualIRI` map) since the target was committed on a *prior* run, not this one.
func TestRunSync_RelationTargetRetriedOnLaterRun(t *testing.T) {
	engine, store := newTestEngine(t)
	componentClassIRI := testClassIRI
	groupClassIRI := "http://ld.example.org/schema#Group"
	seedMapping(store, engine.vocab, "Component", componentClassIRI)
	seedMapping(store, engine.vocab, "Group", groupClassIRI)
	seedNamespace(store, engine.vocab, componentClassIRI, testNamespaceBaseIRI)
	seedNamespace(store, engine.vocab, groupClassIRI, testNamespaceBaseIRI)

	ownedByProp := "http://ld.example.org/schema#ownedBy"
	seedSourceRelation(store, engine.vocab, ownedByProp, "ownedBy")
	seedPropertyShape(store, componentClassIRI, ownedByProp, "http://ld.example.org/shapes#ownedBy", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Group"},
		entities: map[string][]Entity{
			"Group": {{UID: "team-1", Name: "Payments Team", Kind: "Group", SourceRef: "group:default/payments-team"}},
		},
	}

	// Run 1: only the Group entity is present upstream — Component isn't discovered/related yet.
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}

	componentIRI := "http://ld.example.org/backstage#backstage-abc-1"
	groupIRI := "http://ld.example.org/backstage#backstage-team-1"
	if store.Has("http://ld.example.org/backstage", componentIRI, ownedByProp, groupIRI, true) {
		t.Fatal("edge must not exist yet after run 1 (Component doesn't exist upstream yet)")
	}

	// Run 2: Component now exists upstream with a relation to the already-synced Group — Group's own
	// entity list is left empty this run, forcing resolution through the GraphDB fallback lookup
	// rather than the in-run map.
	source.entities["Component"] = []Entity{{
		UID: "abc-1", Name: "Payments API", Kind: "Component",
		Relations: []Relation{{Type: "ownedBy", TargetRef: "group:default/payments-team"}},
	}}
	source.entities["Group"] = nil

	summary, err := engine.RunSync(context.Background(), source, false)
	if err != nil {
		t.Fatalf("run 2 error = %v", err)
	}
	if len(summary.SkippedRelations) != 0 {
		t.Errorf("run 2 SkippedRelations = %v, want none (target now resolvable from a prior run)", summary.SkippedRelations)
	}
	if !store.Has("http://ld.example.org/backstage", componentIRI, ownedByProp, groupIRI, true) {
		t.Error("expected the edge to appear on run 2, once its target was actually synced")
	}
}

func TestRunSync_RelationEdgeRerunIsIdempotent(t *testing.T) {
	engine, store := newTestEngine(t)
	componentClassIRI := testClassIRI
	groupClassIRI := "http://ld.example.org/schema#Group"
	seedMapping(store, engine.vocab, "Component", componentClassIRI)
	seedMapping(store, engine.vocab, "Group", groupClassIRI)
	seedNamespace(store, engine.vocab, componentClassIRI, testNamespaceBaseIRI)
	seedNamespace(store, engine.vocab, groupClassIRI, testNamespaceBaseIRI)

	ownedByProp := "http://ld.example.org/schema#ownedBy"
	seedSourceRelation(store, engine.vocab, ownedByProp, "ownedBy")
	seedPropertyShape(store, componentClassIRI, ownedByProp, "http://ld.example.org/shapes#ownedBy", false)

	source := &fixtureSource{
		name:  "backstage",
		kinds: []string{"Component", "Group"},
		entities: map[string][]Entity{
			"Component": {{
				UID: "abc-1", Name: "Payments API", Kind: "Component",
				Relations: []Relation{{Type: "ownedBy", TargetRef: "group:default/payments-team"}},
			}},
			"Group": {{UID: "team-1", Name: "Payments Team", Kind: "Group", SourceRef: "group:default/payments-team"}},
		},
	}

	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 1 error = %v", err)
	}
	if _, err := engine.RunSync(context.Background(), source, false); err != nil {
		t.Fatalf("run 2 error = %v", err)
	}

	componentIRI := "http://ld.example.org/backstage#backstage-abc-1"
	groupIRI := "http://ld.example.org/backstage#backstage-team-1"
	if got := store.CountMatching("http://ld.example.org/backstage", componentIRI, ownedByProp); got != 1 {
		t.Errorf("ownedBy edge count = %d after two identical runs, want exactly 1 (RDF set semantics, no duplicate)", got)
	}
	if !store.Has("http://ld.example.org/backstage", componentIRI, ownedByProp, groupIRI, true) {
		t.Error("expected the edge to still point at the Group individual after re-run")
	}
}
