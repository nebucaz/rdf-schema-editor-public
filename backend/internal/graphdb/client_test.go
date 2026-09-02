package graphdb

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

func TestClient_Select_Success(t *testing.T) {
	var gotAccept, gotAuth, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		gotAuth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.Write([]byte(`{"results":{"bindings":[{"class":{"type":"uri","value":"urn:a"},"kind":{"type":"literal","value":"Component"}}]}}`))
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL, GraphDBUser: "alice", GraphDBPassword: "s3cret"})
	result, err := c.Select(context.Background(), "SELECT ?class ?kind WHERE { ?class <urn:backstageKind> ?kind }")
	if err != nil {
		t.Fatalf("Select() error = %v", err)
	}
	if gotAccept != "application/sparql-results+json" {
		t.Errorf("Accept header = %q", gotAccept)
	}
	if gotAuth == "" {
		t.Error("missing Authorization header")
	}
	if !strings.Contains(gotBody, "infer=false") {
		t.Errorf("request body = %q, want infer=false", gotBody)
	}
	if len(result.Results.Bindings) != 1 {
		t.Fatalf("bindings = %d, want 1", len(result.Results.Bindings))
	}
	if result.Results.Bindings[0]["class"].Value != "urn:a" {
		t.Errorf("class binding = %q", result.Results.Bindings[0]["class"].Value)
	}
	if result.Results.Bindings[0]["kind"].Value != "Component" {
		t.Errorf("kind binding = %q", result.Results.Bindings[0]["kind"].Value)
	}
}

func TestClient_Select_GraphDBError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL})
	if _, err := c.Select(context.Background(), "SELECT * WHERE { ?s ?p ?o }"); err == nil {
		t.Error("Select() returned no error on GraphDB 500")
	}
}

func TestClient_Select_Unreachable(t *testing.T) {
	c := NewClient(config.Config{GraphDBEndpointURL: "http://127.0.0.1:0"})
	if _, err := c.Select(context.Background(), "SELECT * WHERE { ?s ?p ?o }"); err == nil {
		t.Error("Select() returned no error for unreachable endpoint")
	}
}

func TestClient_Ask_Success(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.Write([]byte(`{"boolean":true}`))
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL})
	got, err := c.Ask(context.Background(), "ASK { ?s ?p ?o }")
	if err != nil {
		t.Fatalf("Ask() error = %v", err)
	}
	if !got {
		t.Error("Ask() = false, want true")
	}
}

func TestClient_Ask_GraphDBError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL})
	if _, err := c.Ask(context.Background(), "ASK { ?s ?p ?o }"); err == nil {
		t.Error("Ask() returned no error on GraphDB 500")
	}
}

func TestClient_Update_Success(t *testing.T) {
	var gotPath, gotContentType, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		gotBody = string(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL})
	update := `INSERT DATA { GRAPH <urn:g> { <urn:s> <urn:p> <urn:o> . } }`
	if err := c.Update(context.Background(), update); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if gotPath != "/statements" {
		t.Errorf("path = %q, want /statements", gotPath)
	}
	if gotContentType != "application/sparql-update" {
		t.Errorf("Content-Type = %q", gotContentType)
	}
	if gotBody != update {
		t.Errorf("body = %q, want %q", gotBody, update)
	}
}

func TestClient_Update_GraphDBError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte("malformed update"))
	}))
	defer server.Close()

	c := NewClient(config.Config{GraphDBEndpointURL: server.URL})
	if err := c.Update(context.Background(), "INSERT DATA { }"); err == nil {
		t.Error("Update() returned no error on GraphDB 400")
	}
}
