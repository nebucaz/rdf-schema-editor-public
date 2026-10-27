package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func jsonReq(path, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func assertJSONMessage(t *testing.T, w *httptest.ResponseRecorder, wantStatus int) string {
	t.Helper()
	if w.Code != wantStatus {
		t.Errorf("status = %d, want %d", w.Code, wantStatus)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body.String(), err)
	}
	if body.Message == "" {
		t.Errorf("body %q has empty message", w.Body.String())
	}
	return body.Message
}

func TestSparqlHandler_Query_JSONBody(t *testing.T) {
	var gotBody string
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody = readBody(r)
		w.Header().Set("Content-Type", "application/sparql-results+json")
		w.Write([]byte(`{"results":{"bindings":[]}}`))
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	w := httptest.NewRecorder()
	h.Query(w, jsonReq("/sparql", `{"query":"SELECT * WHERE { ?s ?p ?o }","infer":false}`))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !strings.Contains(gotBody, "infer=false") || !strings.Contains(gotBody, "query=SELECT") {
		t.Errorf("GraphDB body = %q, want query + infer=false", gotBody)
	}
	if w.Body.String() != `{"results":{"bindings":[]}}` {
		t.Errorf("body = %q, want passthrough", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/sparql-results+json" {
		t.Errorf("Content-Type = %q, want sparql-results+json", ct)
	}
}

func TestSparqlHandler_Query_JSONInferTrueOrAbsentOmitsParam(t *testing.T) {
	for _, body := range []string{`{"query":"ASK {}"}`, `{"query":"ASK {}","infer":true}`} {
		var gotBody string
		graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotBody = readBody(r)
		}))
		h := newTestHandler(t, graphdb)
		h.Query(httptest.NewRecorder(), jsonReq("/sparql", body))
		graphdb.Close()
		if strings.Contains(gotBody, "infer") {
			t.Errorf("body %s: GraphDB got %q, want no infer param", body, gotBody)
		}
	}
}

func TestSparqlHandler_Update_JSONBody(t *testing.T) {
	var gotBody, gotPath string
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, gotPath = readBody(r), r.URL.Path
	}))
	defer graphdb.Close()

	h := newTestHandler(t, graphdb)
	w := httptest.NewRecorder()
	h.Update(w, jsonReq("/sparql/update", `{"update":"INSERT DATA { <urn:a> <urn:b> <urn:c> }"}`))

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if gotPath != "/statements" || gotBody != "INSERT DATA { <urn:a> <urn:b> <urn:c> }" {
		t.Errorf("GraphDB got path %q body %q", gotPath, gotBody)
	}
}

func TestSparqlHandler_JSONErrors(t *testing.T) {
	unreachable := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	unreachable.Close()

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("malformed SPARQL query"))
	}))
	defer upstream.Close()

	cases := []struct {
		name   string
		call   func(h *SparqlHandler, w http.ResponseWriter)
		useURL string
		status int
		msg    string
	}{
		{"query missing", func(h *SparqlHandler, w http.ResponseWriter) { h.Query(w, jsonReq("/sparql", `{}`)) }, "up", 400, `Missing or invalid "query" parameter`},
		{"query not a string", func(h *SparqlHandler, w http.ResponseWriter) { h.Query(w, jsonReq("/sparql", `{"query":5}`)) }, "up", 400, `Missing or invalid "query" parameter`},
		{"query malformed json", func(h *SparqlHandler, w http.ResponseWriter) { h.Query(w, jsonReq("/sparql", `{not json`)) }, "up", 400, "malformed request body"},
		{"update missing", func(h *SparqlHandler, w http.ResponseWriter) {
			h.Update(w, jsonReq("/sparql/update", `{"update":"  "}`))
		}, "up", 400, `Missing or invalid "update" parameter`},
		{"query graphdb down", func(h *SparqlHandler, w http.ResponseWriter) { h.Query(w, jsonReq("/sparql", `{"query":"ASK {}"}`)) }, "down", 502, "GraphDB unreachable"},
		{"update graphdb down", func(h *SparqlHandler, w http.ResponseWriter) {
			h.Update(w, jsonReq("/sparql/update", `{"update":"CLEAR ALL"}`))
		}, "down", 502, "GraphDB unreachable"},
		{"query upstream error", func(h *SparqlHandler, w http.ResponseWriter) { h.Query(w, jsonReq("/sparql", `{"query":"SELECT"}`)) }, "up", 500, "malformed SPARQL query"},
		{"update upstream error", func(h *SparqlHandler, w http.ResponseWriter) {
			h.Update(w, jsonReq("/sparql/update", `{"update":"X"}`))
		}, "up", 500, "malformed SPARQL query"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := upstream
			if tc.useURL == "down" {
				srv = unreachable
			}
			h := newTestHandler(t, srv)
			w := httptest.NewRecorder()
			tc.call(h, w)
			msg := assertJSONMessage(t, w, tc.status)
			if !strings.Contains(msg, tc.msg) {
				t.Errorf("message = %q, want it to contain %q", msg, tc.msg)
			}
		})
	}
}

func TestSparqlHandler_UpstreamSuccessNotWrapped(t *testing.T) {
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer graphdb.Close()
	w := httptest.NewRecorder()
	newTestHandler(t, graphdb).Update(w, jsonReq("/sparql/update", `{"update":"X"}`))
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Errorf("got %d %q, want bare 204", w.Code, w.Body.String())
	}
}

func TestSparqlHandler_AuditLogRecordsJSONPath(t *testing.T) {
	graphdb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer graphdb.Close()
	var sb strings.Builder
	orig := auditOut
	auditOut = &sb
	defer func() { auditOut = orig }()

	req := jsonReq("/sparql", `{"query":"ASK {}"}`)
	req = withSubject(req, "alice")
	newTestHandler(t, graphdb).Query(httptest.NewRecorder(), req)

	if !strings.Contains(sb.String(), `"caller":"alice"`) || !strings.Contains(sb.String(), "ASK {}") || !strings.Contains(sb.String(), `"status":200`) {
		t.Errorf("audit line = %q", sb.String())
	}
}
