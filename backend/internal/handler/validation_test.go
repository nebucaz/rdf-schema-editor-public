package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

func newValidationTestRouter(h *ValidationHandler) http.Handler {
	r := chi.NewRouter()
	r.Get("/validation/report", h.Report)
	return r
}

func TestValidationHandler_Report_ReturnsViolations(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		query := r.FormValue("query")
		w.Header().Set("Content-Type", "application/sparql-results+json")

		switch {
		case strings.Contains(query, "subClassOf"):
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
		case strings.Contains(query, "rdf-syntax-ns#rest"):
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
		case strings.Contains(query, "shacl#targetClass"):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"class":{"type":"uri","value":"http://ns#Person"},"path":{"type":"uri","value":"http://ns#name"},"minCount":{"type":"literal","value":"1"}}
			]}}`)
		case strings.Contains(query, "SELECT DISTINCT"):
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
		default:
			fmt.Fprint(w, `{"results":{"bindings":[
				{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Person"}}
			]}}`)
		}
	}))
	defer graphdbServer.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	h := NewValidationHandler(gdb)
	router := newValidationTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/validation/report", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	var violations []validation.Violation
	if err := json.Unmarshal(w.Body.Bytes(), &violations); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(violations) != 1 || violations[0].Constraint != "minCount" {
		t.Fatalf("violations = %+v, want exactly 1 minCount violation", violations)
	}
}

func TestValidationHandler_Report_EmptyArrayNotNull(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/sparql-results+json")
		fmt.Fprint(w, `{"results":{"bindings":[]}}`)
	}))
	defer graphdbServer.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	h := NewValidationHandler(gdb)
	router := newValidationTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/validation/report", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", w.Code, w.Body.String())
	}
	if w.Body.String() != "[]\n" {
		t.Errorf("body = %q, want the literal empty JSON array, never null", w.Body.String())
	}
}

func TestValidationHandler_Report_GraphDBUnreachableReturns502(t *testing.T) {
	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://127.0.0.1:1"})
	h := NewValidationHandler(gdb)
	router := newValidationTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/validation/report", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", w.Code)
	}
}
