package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/backstage"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

type fakeSource struct {
	name          string
	kinds         []string
	discoverError error
	entities      map[string][]sync.Entity
	fetchError    error
	// blockUntil, if set, is waited on before DiscoverKinds returns — lets a test hold a RunSync
	// call open long enough to fire a second, concurrent request against it.
	blockUntil <-chan struct{}
}

func (f *fakeSource) Name() string { return f.name }

func (f *fakeSource) DiscoverKinds(ctx context.Context) ([]string, error) {
	if f.blockUntil != nil {
		<-f.blockUntil
	}
	if f.discoverError != nil {
		return nil, f.discoverError
	}
	return f.kinds, nil
}

func (f *fakeSource) FetchEntities(ctx context.Context, kind string) ([]sync.Entity, error) {
	if f.fetchError != nil {
		return nil, f.fetchError
	}
	return f.entities[kind], nil
}

func newTestRouter(h *SourceHandler) http.Handler {
	r := chi.NewRouter()
	r.Get("/sources/{source}/discover", h.Discover)
	r.Post("/sources/{source}/sync", h.Sync)
	return r
}

// testEngine builds a sync.Engine against the same GraphDB test server other requests in a test
// case use, with a vocabulary matching this file's own "http://ns/schema#backstageKind" convention.
func testEngine(gdb *graphdb.Client) *sync.Engine {
	return sync.NewEngine(gdb, sync.Vocabulary{
		DefaultNamespaceBaseIRI:   "http://ns",
		BackstageKindPredicateIRI: "http://ns/schema#backstageKind",
		SyncSourcePredicateIRI:    "http://ns/schema#syncSource",
		SyncStatusPredicateIRI:    "http://ns/schema#syncStatus",
		NamespaceClassIRI:         "http://ns/schema#Namespace",
		NamespacePrefixIRI:        "http://ns/schema#prefix",
	})
}

func TestSourceHandler_Discover_ReturnsUnmappedKinds(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		fmt.Fprint(w, `{
			"results": {
				"bindings": [
					{"class": {"type": "uri", "value": "http://ns/schema#Application"}, "kind": {"type": "literal", "value": "Component"}}
				]
			}
		}`)
	}))
	defer graphdbServer.Close()

	registry := sync.NewRegistry()
	registry.Register(&fakeSource{name: "backstage", kinds: []string{"Component", "System", "Domain"}})

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/sources/backstage/discover", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	var resp discoverResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Source != "backstage" {
		t.Errorf("source = %q, want backstage", resp.Source)
	}
	want := map[string]bool{"System": true, "Domain": true}
	if len(resp.UnmappedKinds) != 2 || !want[resp.UnmappedKinds[0]] || !want[resp.UnmappedKinds[1]] {
		t.Errorf("unmappedKinds = %v, want [System Domain] in some order", resp.UnmappedKinds)
	}
}

// TestSourceHandler_Discover_RealBackstageClientMultiPage wires the endpoint against the real
// backstage.Client (not fakeSource), fed by a paginated fixture server, so the discovery route's
// set-difference logic is exercised end to end against multi-page Backstage responses per Story
// 004's own testing bullet — Story 003's client_test.go covers pagination in isolation, this
// confirms the handler follows it to completion too.
func TestSourceHandler_Discover_RealBackstageClientMultiPage(t *testing.T) {
	page := 0
	backstageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if page == 0 {
			page++
			fmt.Fprint(w, `{
				"items": [
					{"apiVersion":"backstage.io/v1alpha1","kind":"Component","metadata":{"uid":"1","name":"a"}}
				],
				"totalItems": 3,
				"pageInfo": {"nextCursor": "cursor-2"}
			}`)
			return
		}
		fmt.Fprint(w, `{
			"items": [
				{"apiVersion":"backstage.io/v1alpha1","kind":"System","metadata":{"uid":"2","name":"b"}},
				{"apiVersion":"backstage.io/v1alpha1","kind":"Domain","metadata":{"uid":"3","name":"c"}}
			],
			"totalItems": 3,
			"pageInfo": {}
		}`)
	}))
	defer backstageServer.Close()

	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		fmt.Fprint(w, `{
			"results": {
				"bindings": [
					{"class": {"type": "uri", "value": "http://ns/schema#Application"}, "kind": {"type": "literal", "value": "Component"}}
				]
			}
		}`)
	}))
	defer graphdbServer.Close()

	registry := sync.NewRegistry()
	registry.Register(backstage.NewClient(backstageServer.URL, ""))
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/sources/backstage/discover", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	var resp discoverResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	want := map[string]bool{"System": true, "Domain": true}
	if len(resp.UnmappedKinds) != 2 || !want[resp.UnmappedKinds[0]] || !want[resp.UnmappedKinds[1]] {
		t.Errorf("unmappedKinds = %v, want [System Domain] in some order (Component is mapped)", resp.UnmappedKinds)
	}
}

func TestSourceHandler_Discover_UnknownSource(t *testing.T) {
	registry := sync.NewRegistry()
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/sources/nope/discover", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestSourceHandler_Discover_UpstreamUnreachable(t *testing.T) {
	registry := sync.NewRegistry()
	registry.Register(&fakeSource{name: "backstage", discoverError: fmt.Errorf("connection refused")})
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/sources/backstage/discover", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", w.Code)
	}
}

func TestSourceHandler_Discover_AllKindsMapped(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		fmt.Fprint(w, `{
			"results": {
				"bindings": [
					{"class": {"type": "uri", "value": "http://ns/schema#Application"}, "kind": {"type": "literal", "value": "Component"}}
				]
			}
		}`)
	}))
	defer graphdbServer.Close()

	registry := sync.NewRegistry()
	registry.Register(&fakeSource{name: "backstage", kinds: []string{"Component"}})
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/sources/backstage/discover", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp discoverResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.UnmappedKinds) != 0 {
		t.Errorf("unmappedKinds = %v, want empty", resp.UnmappedKinds)
	}
}

// -- POST /sources/{source}/sync (Story 008) ---------------------------------------------------

func TestSourceHandler_Sync_DryRunDefault(t *testing.T) {
	graphdbServer, store := graphdbtest.NewServer()
	defer graphdbServer.Close()
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	store.Seed(graphdbtest.Triple{
		Graph: "http://ns/schema", S: "http://ns/schema#Application", P: "http://ns/schema#backstageKind", O: "Component",
	})

	registry := sync.NewRegistry()
	registry.Register(&fakeSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]sync.Entity{
			"Component": {{UID: "1", Name: "a", Kind: "Component"}},
		},
	})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=true", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	var summary sync.SyncSummary
	if err := json.Unmarshal(w.Body.Bytes(), &summary); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !summary.DryRun {
		t.Error("dryRun = false, want true")
	}
	if summary.SyncedPerKind["Component"] != 1 {
		t.Errorf("syncedPerKind[Component] = %d, want 1", summary.SyncedPerKind["Component"])
	}
	if len(store.Snapshot()) != 1 {
		t.Errorf("triple count = %d after a dry run, want unchanged (only the seeded mapping triple)", len(store.Snapshot()))
	}
}

func TestSourceHandler_Sync_ApplyWritesToGraph(t *testing.T) {
	graphdbServer, store := graphdbtest.NewServer()
	defer graphdbServer.Close()
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	store.Seed(graphdbtest.Triple{
		Graph: "http://ns/schema", S: "http://ns/schema#Application", P: "http://ns/schema#backstageKind", O: "Component",
	})

	registry := sync.NewRegistry()
	registry.Register(&fakeSource{
		name:  "backstage",
		kinds: []string{"Component"},
		entities: map[string][]sync.Entity{
			"Component": {{UID: "1", Name: "a", Kind: "Component"}},
		},
	})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=false", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	if len(store.Snapshot()) <= 1 {
		t.Error("expected a real sync to write new triples beyond the seeded mapping")
	}
}

func TestSourceHandler_Sync_UnknownSource(t *testing.T) {
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})
	registry := sync.NewRegistry()
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/sources/nope/sync", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", w.Code)
	}
}

func TestSourceHandler_Sync_UpstreamUnreachable(t *testing.T) {
	graphdbServer, store := graphdbtest.NewServer()
	defer graphdbServer.Close()
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	store.Seed(graphdbtest.Triple{
		Graph: "http://ns/schema", S: "http://ns/schema#Application", P: "http://ns/schema#backstageKind", O: "Component",
	})

	registry := sync.NewRegistry()
	registry.Register(&fakeSource{
		name:       "backstage",
		kinds:      []string{"Component"},
		fetchError: fmt.Errorf("connection refused"),
	})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	req := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=false", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", w.Code)
	}
}

func TestSourceHandler_Sync_ConcurrentRealSyncConflict(t *testing.T) {
	graphdbServer, _ := graphdbtest.NewServer()
	defer graphdbServer.Close()
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})

	block := make(chan struct{})
	registry := sync.NewRegistry()
	registry.Register(&fakeSource{name: "backstage", kinds: []string{}, blockUntil: block})
	h := NewSourceHandler(registry, gdb, "http://ns/schema#backstageKind", testEngine(gdb))
	router := newTestRouter(h)

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=false", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		firstDone <- w
	}()

	// Give the first request time to acquire the in-flight guard before firing the second. It's
	// now blocked inside DiscoverKinds — a second real-sync request must be rejected without ever
	// reaching the source (the guard check happens before any source call), so this is safe from
	// the deadlock a second blocking DiscoverKinds call would otherwise risk.
	time.Sleep(50 * time.Millisecond)

	req2 := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=false", nil)
	w2 := httptest.NewRecorder()
	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Errorf("second concurrent real-sync status = %d, want 409", w2.Code)
	}

	close(block)
	w1 := <-firstDone
	if w1.Code != http.StatusOK {
		t.Errorf("first real-sync status = %d, want 200, body: %s", w1.Code, w1.Body.String())
	}

	// Now that the real sync has released its guard, a dry run against the same source still
	// succeeds normally (Engine-level exemption from the in-flight guard while one is actually
	// held concurrently is covered directly by sync.TestRunSync_ConcurrentRealSyncRejected, which
	// can manipulate Engine's unexported guard state from within the sync package itself).
	req3 := httptest.NewRequest(http.MethodPost, "/sources/backstage/sync?dryRun=true", nil)
	w3 := httptest.NewRecorder()
	router.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Errorf("dry-run status = %d, want 200", w3.Code)
	}
}
