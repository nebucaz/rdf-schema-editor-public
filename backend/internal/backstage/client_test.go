package backstage

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

func TestClient_DiscoverKinds_PaginatesAndDedupes(t *testing.T) {
	var gotAuth string
	var gotFields []string
	page := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotFields = append(gotFields, r.URL.Query().Get("fields"))
		w.Header().Set("Content-Type", "application/json")
		if page == 0 {
			page++
			fmt.Fprint(w, `{
				"items": [
					{"apiVersion":"backstage.io/v1alpha1","kind":"Component","metadata":{"uid":"1","name":"a"}},
					{"apiVersion":"backstage.io/v1alpha1","kind":"Component","metadata":{"uid":"2","name":"b"}}
				],
				"totalItems": 3,
				"pageInfo": {"nextCursor": "cursor-2"}
			}`)
			return
		}
		fmt.Fprint(w, `{
			"items": [
				{"apiVersion":"backstage.io/v1alpha1","kind":"System","metadata":{"uid":"3","name":"c"}}
			],
			"totalItems": 3,
			"pageInfo": {}
		}`)
	}))
	defer server.Close()

	c := NewClient(server.URL, "secret-token")
	kinds, err := c.DiscoverKinds(context.Background())
	if err != nil {
		t.Fatalf("DiscoverKinds() error = %v", err)
	}
	if gotAuth != "Bearer secret-token" {
		t.Errorf("Authorization header = %q", gotAuth)
	}
	for _, f := range gotFields {
		if f != "kind" {
			t.Errorf("fields param = %q, want \"kind\"", f)
		}
	}
	want := map[string]bool{"Component": true, "System": true}
	if len(kinds) != 2 || !want[kinds[0]] || !want[kinds[1]] {
		t.Errorf("kinds = %v, want distinct [Component System] in some order", kinds)
	}
}

func TestClient_FetchEntities_FiltersByKindAndParsesSpec(t *testing.T) {
	var gotFilter string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotFilter = r.URL.Query().Get("filter")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"items": [
				{
					"apiVersion": "backstage.io/v1alpha1",
					"kind": "Component",
					"metadata": {"uid": "uid-1", "name": "my-service"},
					"spec": {"type": "service", "lifecycle": "production"}
				}
			],
			"totalItems": 1,
			"pageInfo": {}
		}`)
	}))
	defer server.Close()

	c := NewClient(server.URL, "")
	entities, err := c.FetchEntities(context.Background(), "Component")
	if err != nil {
		t.Fatalf("FetchEntities() error = %v", err)
	}
	if gotFilter != "kind=Component" {
		t.Errorf("filter param = %q, want kind=Component", gotFilter)
	}
	if len(entities) != 1 {
		t.Fatalf("entities = %d, want 1", len(entities))
	}
	got := entities[0]
	if got.UID != "uid-1" || got.Name != "my-service" || got.Kind != "Component" {
		t.Errorf("entity = %+v", got)
	}
	if got.Attributes["type"] != "service" || got.Attributes["lifecycle"] != "production" {
		t.Errorf("attributes = %v", got.Attributes)
	}
}

func TestClient_FetchEntities_EmptyResultSet(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"items": [], "totalItems": 0, "pageInfo": {}}`)
	}))
	defer server.Close()

	c := NewClient(server.URL, "")
	entities, err := c.FetchEntities(context.Background(), "Domain")
	if err != nil {
		t.Fatalf("FetchEntities() error = %v", err)
	}
	if len(entities) != 0 {
		t.Errorf("entities = %v, want empty", entities)
	}
}

// TestClient_SatisfiesSourceInterface is written purely against sync.Source, not *backstage.Client
// — per Story 003's AC, this must keep passing even if Client grows methods beyond the interface.
func TestClient_SatisfiesSourceInterface(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"items": [], "totalItems": 0, "pageInfo": {}}`)
	}))
	defer server.Close()

	var src sync.Source = NewClient(server.URL, "")
	if src.Name() != "backstage" {
		t.Errorf("Name() = %q, want backstage", src.Name())
	}
	if _, err := src.DiscoverKinds(context.Background()); err != nil {
		t.Errorf("DiscoverKinds() via Source interface error = %v", err)
	}
	if _, err := src.FetchEntities(context.Background(), "Component"); err != nil {
		t.Errorf("FetchEntities() via Source interface error = %v", err)
	}
}
