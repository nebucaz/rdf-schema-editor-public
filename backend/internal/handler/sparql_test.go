package handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

func readBody(r *http.Request) string {
	body, _ := io.ReadAll(r.Body)
	return string(body)
}

func newTestHandler(t *testing.T, graphdb *httptest.Server) *SparqlHandler {
	t.Helper()
	return NewSparqlHandler(config.Config{
		GraphDBEndpointURL: graphdb.URL,
		GraphDBUser:        "alice",
		GraphDBPassword:    "s3cret",
	})
}

func TestSparqlHandler_Query_Success(t *testing.T) {
	var gotMethod, gotContentType, gotAccept, gotAuth, gotBody string
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotContentType = r.Header.Get("Content-Type")
		gotAccept = r.Header.Get("Accept")
		gotAuth = r.Header.Get("Authorization")
		body := readBody(r)
		gotBody = body
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"results":{"bindings":[]}}`))
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	form := url.Values{"query": {"SELECT * WHERE { ?s ?p ?o }"}, "infer": {"false"}}
	req := httptest.NewRequest(http.MethodPost, "/sparql", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	h.Query(w, req)

	if gotMethod != http.MethodPost {
		t.Errorf("GraphDB request method = %q, want POST", gotMethod)
	}
	if gotContentType != "application/x-www-form-urlencoded" {
		t.Errorf("GraphDB request Content-Type = %q", gotContentType)
	}
	if gotAccept != "application/sparql-results+json" {
		t.Errorf("GraphDB request Accept = %q", gotAccept)
	}
	if gotAuth == "" {
		t.Error("GraphDB request missing Authorization header")
	}
	if !strings.Contains(gotBody, "infer=false") {
		t.Errorf("GraphDB request body = %q, want infer=false", gotBody)
	}
	if w.Code != http.StatusOK {
		t.Errorf("response status = %d, want 200", w.Code)
	}
	if w.Body.String() != `{"results":{"bindings":[]}}` {
		t.Errorf("response body = %q, want passthrough of GraphDB body", w.Body.String())
	}
}

func TestSparqlHandler_Query_GraphDBErrorPassthrough(t *testing.T) {
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("malformed SPARQL query"))
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	form := url.Values{"query": {"SELECT"}}
	req := httptest.NewRequest(http.MethodPost, "/sparql", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	h.Query(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Errorf("response status = %d, want 500 passed through from GraphDB", w.Code)
	}
	if w.Body.String() != "malformed SPARQL query" {
		t.Errorf("response body = %q, want GraphDB's error passed through", w.Body.String())
	}
}

func TestSparqlHandler_Query_MissingQueryParam(t *testing.T) {
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("GraphDB should not be called for a malformed request")
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	req := httptest.NewRequest(http.MethodPost, "/sparql", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	h.Query(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("response status = %d, want 400", w.Code)
	}
}

func TestSparqlHandler_Update_Success(t *testing.T) {
	var gotPath, gotContentType, gotBody string
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		body := readBody(r)
		gotBody = body
		w.WriteHeader(http.StatusOK)
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	form := url.Values{"update": {"INSERT DATA { <urn:a> <urn:b> <urn:c> }"}}
	req := httptest.NewRequest(http.MethodPost, "/sparql/update", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	h.Update(w, req)

	if gotPath != "/statements" {
		t.Errorf("GraphDB request path = %q, want /statements", gotPath)
	}
	if gotContentType != "application/sparql-update" {
		t.Errorf("GraphDB request Content-Type = %q, want application/sparql-update", gotContentType)
	}
	if gotBody != "INSERT DATA { <urn:a> <urn:b> <urn:c> }" {
		t.Errorf("GraphDB request body = %q, want raw update string", gotBody)
	}
	if w.Code != http.StatusOK {
		t.Errorf("response status = %d, want 200", w.Code)
	}
}

func TestSparqlHandler_Update_MissingUpdateParam(t *testing.T) {
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("GraphDB should not be called for a malformed request")
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	req := httptest.NewRequest(http.MethodPost, "/sparql/update", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()

	h.Update(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("response status = %d, want 400", w.Code)
	}
}
