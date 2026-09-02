package sync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

func TestFetchKindMapping_MultipleNamespacesAndUnmapped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.Write([]byte(`{
			"results": {
				"bindings": [
					{"class": {"type": "uri", "value": "http://ns-a/schema#Application"}, "kind": {"type": "literal", "value": "Component"}},
					{"class": {"type": "uri", "value": "http://ns-b/schema#Service"}, "kind": {"type": "literal", "value": "System"}}
				]
			}
		}`))
	}))
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	mapping, err := FetchKindMapping(context.Background(), gdb, "http://example.org/schema#backstageKind")
	if err != nil {
		t.Fatalf("FetchKindMapping() error = %v", err)
	}
	if mapping["Component"] != "http://ns-a/schema#Application" {
		t.Errorf("mapping[Component] = %q", mapping["Component"])
	}
	if mapping["System"] != "http://ns-b/schema#Service" {
		t.Errorf("mapping[System] = %q", mapping["System"])
	}
	if _, ok := mapping["API"]; ok {
		t.Error("mapping should not contain an entry for an unmapped kind")
	}
}

func TestFetchKindMapping_Empty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.Write([]byte(`{"results":{"bindings":[]}}`))
	}))
	defer server.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: server.URL})
	mapping, err := FetchKindMapping(context.Background(), gdb, "http://example.org/schema#backstageKind")
	if err != nil {
		t.Fatalf("FetchKindMapping() error = %v", err)
	}
	if len(mapping) != 0 {
		t.Errorf("mapping = %v, want empty", mapping)
	}
}
