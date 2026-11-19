package sync

// Guard (spec/concept-valued-properties STORY-439): the Backstage sync never writes SKOS concepts.
// Concepts are manual work following the ontology pipeline. "Concept" inside this package means the app's
// Concept Namespace (`rse:namespace`, the `backstage:` shadow classes), not `skos:Concept`.

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdbtest"
)

const skosNamespace = "http://www.w3.org/2004/02/skos/core#"

// conceptWriteViolation names what is wrong with an update text, or "" when it leaves concepts alone.
func conceptWriteViolation(update string) string {
	switch {
	case strings.Contains(update, skosNamespace):
		return "touches the SKOS namespace"
	case strings.Contains(update, "skos:"):
		return "uses a skos: prefix"
	case strings.Contains(update, "/vocab>"):
		return "writes into a <base>/vocab graph"
	}
	return ""
}

func TestConceptWriteViolation_CatchesEachKindOfWrite(t *testing.T) {
	for name, update := range map[string]string{
		"skos namespace": `INSERT DATA { GRAPH <http://x/g> { <http://x#c> a <` + skosNamespace + `Concept> } }`,
		"skos prefix":    `INSERT DATA { GRAPH <http://x/g> { <http://x#c> skos:inScheme <http://x#s> } }`,
		"vocab graph":    `INSERT DATA { GRAPH <http://x/core/vocab> { <http://x#c> <http://x#p> "v" } }`,
	} {
		if conceptWriteViolation(update) == "" {
			t.Errorf("%s: violation not detected in %q", name, update)
		}
	}
	if v := conceptWriteViolation(`INSERT DATA { GRAPH <http://ld.example.org/backstage> { <http://x#i> a <http://x#C> } }`); v != "" {
		t.Errorf("an ordinary individual write was flagged: %s", v)
	}
}

// recordingEngine returns an engine whose GraphDB client goes through a proxy that records every update body.
func recordingEngine(t *testing.T) (*Engine, *graphdbtest.Store, *[]string) {
	t.Helper()
	backend, store := graphdbtest.NewServer()
	t.Cleanup(backend.Close)
	target, _ := url.Parse(backend.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	var updates []string
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/statements" {
			body, _ := io.ReadAll(r.Body)
			updates = append(updates, string(body))
			r.Body = io.NopCloser(strings.NewReader(string(body)))
			r.ContentLength = int64(len(body))
		}
		proxy.ServeHTTP(w, r)
	}))
	t.Cleanup(front.Close)
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: front.URL})
	return NewEngine(gdb, testVocab()), store, &updates
}

func TestRunSync_NeverWritesConcepts(t *testing.T) {
	for _, dryRun := range []bool{true, false} {
		engine, store, updates := recordingEngine(t)
		seedMapping(store, engine.vocab, "Component", testClassIRI)
		seedNamespace(store, engine.vocab, testClassIRI, testNamespaceBaseIRI)
		// A concept already in the vocabulary graph: the sync must leave it exactly as it is.
		const vocabGraph = "http://ld.example.org/core/vocab"
		store.Seed(
			graphdbtest.Triple{Graph: vocabGraph, S: "http://ld.example.org/core/vocab#Active", P: rdfType, O: skosNamespace + "Concept", ObjectIsIRI: true},
			graphdbtest.Triple{Graph: vocabGraph, S: "http://ld.example.org/core/vocab#Active", P: skosNamespace + "inScheme", O: "http://ld.example.org/core/vocab#Lifecycle", ObjectIsIRI: true},
		)
		source := &fixtureSource{
			name:  "backstage",
			kinds: []string{"Component"},
			entities: map[string][]Entity{
				"Component": {{UID: "abc-1", Name: "Payments API", Kind: "Component", Fields: map[string]string{"lifecycle": "production"}}},
			},
		}
		if _, err := engine.RunSync(context.Background(), source, dryRun); err != nil {
			t.Fatalf("dryRun=%v: RunSync() error = %v", dryRun, err)
		}
		if dryRun && len(*updates) != 0 {
			t.Errorf("dry run sent %d updates, want 0", len(*updates))
		}
		if !dryRun && len(*updates) == 0 {
			t.Fatal("apply run sent no updates: the guard would pass vacuously")
		}
		for _, u := range *updates {
			if v := conceptWriteViolation(u); v != "" {
				t.Errorf("dryRun=%v: update %s: %s", dryRun, v, u)
			}
		}
		for _, tr := range store.Snapshot() {
			if tr.Graph == vocabGraph {
				continue
			}
			if strings.HasPrefix(tr.P, skosNamespace) || tr.O == skosNamespace+"Concept" {
				t.Errorf("dryRun=%v: sync wrote a SKOS triple outside the vocabulary graph: %+v", dryRun, tr)
			}
		}
		if !store.Has(vocabGraph, "http://ld.example.org/core/vocab#Active", rdfType, skosNamespace+"Concept", true) ||
			!store.Has(vocabGraph, "http://ld.example.org/core/vocab#Active", skosNamespace+"inScheme", "http://ld.example.org/core/vocab#Lifecycle", true) {
			t.Errorf("dryRun=%v: the existing concept was altered", dryRun)
		}
	}
}
