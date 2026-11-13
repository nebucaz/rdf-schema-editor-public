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
	var report validationReportBody
	if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	violations := report.Violations
	if len(violations) != 1 || violations[0].Constraint != "minCount" {
		t.Fatalf("violations = %+v, want exactly 1 minCount violation", violations)
	}
}

// validationReportBody mirrors the envelope the handler writes.
type validationReportBody struct {
	Violations []validation.Violation  `json:"violations"`
	NotChecked []validation.NotChecked `json:"notChecked"`
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
	if want := "{\"violations\":[],\"notChecked\":[]}\n"; w.Body.String() != want {
		t.Errorf("body = %q, want %q (empty arrays, never null)", w.Body.String(), want)
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

func TestValidationHandler_Report_IncludesSparqlFindings(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		query := r.FormValue("query")
		w.Header().Set("Content-Type", "application/sparql-results+json")
		switch {
		case strings.Contains(query, "VALUES $this"):
			fmt.Fprint(w, `{"results":{"bindings":[{"this":{"type":"uri","value":"http://ns#alice"},"value":{"type":"literal","value":"x"}}]}}`)
		case strings.Contains(query, "shacl#sparql"):
			fmt.Fprint(w, `{"results":{"bindings":[
				{"shape":{"type":"uri","value":"http://ns#S"},"class":{"type":"uri","value":"http://ns#Person"},"sc":{"type":"bnode","value":"b0"},
				 "select":{"type":"literal","value":"SELECT $this ?value WHERE { $this <http://ns#name> ?value }"},"ruleId":{"type":"literal","value":"AC-X"}}
			]}}`)
		case strings.Contains(query, "SELECT ?individual ?type"):
			fmt.Fprint(w, `{"results":{"bindings":[{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Person"}}]}}`)
		default:
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
		}
	}))
	defer graphdbServer.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	router := newValidationTestRouter(NewValidationHandler(gdb))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/validation/report", nil))

	var report validationReportBody
	if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode: %v, body %s", err, w.Body.String())
	}
	violations := report.Violations
	if w.Code != http.StatusOK || len(violations) != 1 || violations[0].Constraint != "sparql" || violations[0].RuleId != "AC-X" {
		t.Fatalf("status = %d, violations = %+v", w.Code, violations)
	}
	if !strings.Contains(w.Body.String(), `"value":"x"`) {
		t.Errorf("the finding must carry the bound ?value in its JSON: %s", w.Body.String())
	}
}

func TestValidationHandler_Report_ListsNotChecked(t *testing.T) {
	graphdbServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		query := r.FormValue("query")
		w.Header().Set("Content-Type", "application/sparql-results+json")
		if strings.Contains(query, "shacl#sparql") {
			fmt.Fprint(w, `{"results":{"bindings":[
				{"shape":{"type":"uri","value":"http://ns#S"},"class":{"type":"uri","value":"http://ns#Person"},"sc":{"type":"bnode","value":"b0"},
				 "select":{"type":"literal","value":"SELECT $this WHERE { SERVICE <http://evil/> { $this ?p ?o } }"},"ruleId":{"type":"literal","value":"AC-BAD"}}
			]}}`)
			return
		}
		if strings.Contains(query, "SELECT DISTINCT") || strings.Contains(query, "subClassOf") || strings.Contains(query, "rdf-syntax-ns#rest") || strings.Contains(query, "shacl#targetClass") {
			fmt.Fprint(w, `{"results":{"bindings":[]}}`)
			return
		}
		fmt.Fprint(w, `{"results":{"bindings":[
			{"individual":{"type":"uri","value":"http://ns#alice"},"type":{"type":"uri","value":"http://ns#Person"}}
		]}}`)
	}))
	defer graphdbServer.Close()

	gdb := graphdb.NewClient(config.Config{GraphDBEndpointURL: graphdbServer.URL})
	router := newValidationTestRouter(NewValidationHandler(gdb))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/validation/report", nil))

	var report validationReportBody
	if err := json.Unmarshal(w.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode: %v, body %s", err, w.Body.String())
	}
	if len(report.NotChecked) != 1 || report.NotChecked[0].RuleId != "AC-BAD" || report.NotChecked[0].Reason == "" {
		t.Fatalf("notChecked = %+v, want the rejected AC-BAD constraint with a reason", report.NotChecked)
	}
	if report.Violations == nil {
		t.Errorf("violations must be [] not null")
	}
}
