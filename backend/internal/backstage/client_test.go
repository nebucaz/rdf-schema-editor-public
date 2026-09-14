package backstage

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if got.Fields["spec.type"] != "service" || got.Fields["spec.lifecycle"] != "production" {
		t.Errorf("fields = %v", got.Fields)
	}
}

// TestClient_FetchEntities_WidenedMetadataAndRelations is Story 098's own dedicated fixture test:
// metadata.labels/annotations/tags and relations[] all decode into sync.Entity's widened shape,
// including a Backstage-shaped `enterprise.catalog.iri` annotation Story 105 later depends on.
func TestClient_FetchEntities_WidenedMetadataAndRelations(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"items": [
				{
					"apiVersion": "backstage.io/v1alpha1",
					"kind": "Component",
					"metadata": {
						"uid": "uid-1",
						"name": "my-service",
						"description": "A payments service",
						"labels": {"environment": "production"},
						"annotations": {"enterprise.catalog.iri": "http://example.org/App-1"},
						"tags": ["payments", "critical"]
					},
					"spec": {"type": "service", "dependsOn": ["Component:default/other"]},
					"relations": [
						{"type": "ownedBy", "targetRef": "group:default/payments-team"}
					]
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
	if len(entities) != 1 {
		t.Fatalf("entities = %d, want 1", len(entities))
	}
	got := entities[0]

	if got.Fields["metadata.name"] != "my-service" {
		t.Errorf("metadata.name = %q", got.Fields["metadata.name"])
	}
	if got.Fields["metadata.description"] != "A payments service" {
		t.Errorf("metadata.description = %q", got.Fields["metadata.description"])
	}
	if got.Fields["metadata.labels.environment"] != "production" {
		t.Errorf("metadata.labels.environment = %q", got.Fields["metadata.labels.environment"])
	}
	if got.Fields["metadata.annotations.enterprise.catalog.iri"] != "http://example.org/App-1" {
		t.Errorf("metadata.annotations.enterprise.catalog.iri = %q", got.Fields["metadata.annotations.enterprise.catalog.iri"])
	}
	if got.Fields["spec.type"] != "service" {
		t.Errorf("spec.type = %q", got.Fields["spec.type"])
	}
	wantTags := []string{"payments", "critical"}
	if len(got.FieldLists["metadata.tags"]) != 2 || got.FieldLists["metadata.tags"][0] != wantTags[0] || got.FieldLists["metadata.tags"][1] != wantTags[1] {
		t.Errorf("metadata.tags = %v, want %v", got.FieldLists["metadata.tags"], wantTags)
	}
	if len(got.FieldLists["spec.dependsOn"]) != 1 || got.FieldLists["spec.dependsOn"][0] != "Component:default/other" {
		t.Errorf("spec.dependsOn = %v", got.FieldLists["spec.dependsOn"])
	}
	if len(got.Relations) != 1 || got.Relations[0].Type != "ownedBy" || got.Relations[0].TargetRef != "group:default/payments-team" {
		t.Errorf("relations = %+v", got.Relations)
	}
	if got.SourceRef != "component:default/my-service" {
		t.Errorf("SourceRef = %q, want %q (lowercase kind, namespace defaulted to \"default\")", got.SourceRef, "component:default/my-service")
	}
}

// TestClient_FetchEntities_SourceRefUsesExplicitNamespace proves a non-default `metadata.namespace`
// is honored verbatim in the computed `targetRef`-shaped SourceRef (STORY-106), rather than always
// falling back to "default".
func TestClient_FetchEntities_SourceRefUsesExplicitNamespace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"items": [
				{
					"apiVersion": "backstage.io/v1alpha1",
					"kind": "Group",
					"metadata": {"uid": "uid-2", "name": "payments-team", "namespace": "teams"}
				}
			],
			"totalItems": 1,
			"pageInfo": {}
		}`)
	}))
	defer server.Close()

	c := NewClient(server.URL, "")
	entities, err := c.FetchEntities(context.Background(), "Group")
	if err != nil {
		t.Fatalf("FetchEntities() error = %v", err)
	}
	if len(entities) != 1 {
		t.Fatalf("entities = %d, want 1", len(entities))
	}
	if got, want := entities[0].SourceRef, "group:teams/payments-team"; got != want {
		t.Errorf("SourceRef = %q, want %q", got, want)
	}
}

// TestClient_FetchEntities_MissingAnnotationsDecodesEmpty proves a response with no
// `metadata.annotations` at all still decodes without error/panic — Story 098's AC explicitly calls
// this out since Story 105's later lookup must never crash on an absent annotations block.
func TestClient_FetchEntities_MissingAnnotationsDecodesEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{
			"items": [
				{
					"apiVersion": "backstage.io/v1alpha1",
					"kind": "Component",
					"metadata": {"uid": "uid-1", "name": "my-service"},
					"spec": {}
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
	if len(entities) != 1 {
		t.Fatalf("entities = %d, want 1", len(entities))
	}
	if v, ok := entities[0].Fields["metadata.annotations.enterprise.catalog.iri"]; ok {
		t.Errorf("expected no entry for an absent annotation, got %q", v)
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

// TestClient_FetchRawEntities_ReturnsUndecodedItemsAcrossPages proves FetchRawEntities preserves
// every field an item carries (including one entityEnvelope doesn't model, e.g. `apiVersion`) and
// pages to completion exactly like FetchEntities/DiscoverKinds — the debugging escape hatch this
// method exists for is only useful if it shows literally what Backstage sent.
func TestClient_FetchRawEntities_ReturnsUndecodedItemsAcrossPages(t *testing.T) {
	var gotFilter string
	page := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotFilter = r.URL.Query().Get("filter")
		w.Header().Set("Content-Type", "application/json")
		if page == 0 {
			page++
			fmt.Fprint(w, `{
				"items": [
					{"apiVersion":"backstage.io/v1alpha1","kind":"Component","metadata":{"uid":"1","name":"a"},"someUnmappedField":"kept"}
				],
				"totalItems": 2,
				"pageInfo": {"nextCursor": "cursor-2"}
			}`)
			return
		}
		fmt.Fprint(w, `{
			"items": [
				{"apiVersion":"backstage.io/v1alpha1","kind":"Component","metadata":{"uid":"2","name":"b"},"relations":[]}
			],
			"totalItems": 2,
			"pageInfo": {}
		}`)
	}))
	defer server.Close()

	c := NewClient(server.URL, "")
	items, err := c.FetchRawEntities(context.Background(), "Component")
	if err != nil {
		t.Fatalf("FetchRawEntities() error = %v", err)
	}
	if gotFilter != "kind=Component" {
		t.Errorf("filter param = %q, want kind=Component", gotFilter)
	}
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2 (paginated across both pages)", len(items))
	}
	if !strings.Contains(string(items[0]), `"someUnmappedField":"kept"`) {
		t.Errorf("items[0] = %s, want it to preserve a field entityEnvelope doesn't model", items[0])
	}
	if !strings.Contains(string(items[1]), `"relations":[]`) {
		t.Errorf("items[1] = %s, want the raw (empty) relations array preserved verbatim", items[1])
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
