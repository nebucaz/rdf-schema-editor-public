package sync

import (
	"context"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
)

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
		DefaultNamespaceBaseIRI:   cfg.DefaultNamespaceBaseIRI(),
		BackstageKindPredicateIRI: cfg.BackstageKindPredicateIRI(),
		SyncSourcePredicateIRI:    cfg.SyncSourcePredicateIRI(),
		SyncStatusPredicateIRI:    cfg.SyncStatusPredicateIRI(),
		NamespaceClassIRI:         cfg.NamespaceClassIRI(),
		NamespacePrefixIRI:        cfg.NamespacePrefixPredicateIRI(),
	}
}

const testClassIRI = "http://ld.example.org/schema#Application"

func seedMapping(store *graphdbtest.Store, vocab Vocabulary, kind, classIRI string) {
	store.Seed(graphdbtest.Triple{
		Graph: "http://ld.example.org/schema", S: classIRI, P: vocab.BackstageKindPredicateIRI, O: kind, ObjectIsIRI: false,
	})
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
	seedMapping(store, engine.vocab, "System", "http://ld.example.org/schema#System")
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
