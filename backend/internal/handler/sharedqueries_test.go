package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/shortlinks"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

const (
	sharedNS     = "https://example.com/o"
	sharedSchema = "https://example.com/o/schema"
	sharedClass  = sharedSchema + "#SharedQuery"
)

// fakeSharedGraph is an in-memory SharedQuery store answering exactly the query shapes the
// handler emits, like the TS route's `mockStore`. The graphdbtest store only understands the sync
// engine's unprefixed shapes, so it cannot stand in here.
type fakeSharedGraph struct {
	mu       sync.Mutex
	classed  bool
	stored   map[string]string // id -> stored (still escaped) model literal
	taken    map[string]bool
	updates  []string
	queries  []string
	failWith error
}

func newFakeSharedGraph(taken ...string) *fakeSharedGraph {
	g := &fakeSharedGraph{stored: map[string]string{}, taken: map[string]bool{}}
	for _, id := range taken {
		g.taken[id] = true
	}
	return g
}

var (
	nodeIDPattern  = regexp.MustCompile(`#SharedQuery([A-Za-z0-9]{10})>`)
	modelLiteralRe = regexp.MustCompile(`queryModelJson> "((?:[^"\\]|\\.)*)"`)
)

func (g *fakeSharedGraph) Ask(_ context.Context, q string) (bool, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.queries = append(g.queries, q)
	if g.failWith != nil {
		return false, g.failWith
	}
	if strings.Contains(q, "a owl:Class") {
		return g.classed, nil
	}
	m := nodeIDPattern.FindStringSubmatch(q)
	if m == nil {
		return false, errors.New("fake: unrecognised ASK")
	}
	_, stored := g.stored[m[1]]
	return stored || g.taken[m[1]], nil
}

func (g *fakeSharedGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.queries = append(g.queries, q)
	var res graphdb.SelectResult
	if g.failWith != nil {
		return res, g.failWith
	}
	m := nodeIDPattern.FindStringSubmatch(q)
	if m == nil {
		return res, errors.New("fake: unrecognised SELECT")
	}
	if lit, ok := g.stored[m[1]]; ok {
		var unescaped string
		_ = json.Unmarshal([]byte(`"`+lit+`"`), &unescaped)
		res.Results.Bindings = []map[string]graphdb.Binding{{"model": {Type: "literal", Value: unescaped}}}
	}
	return res, nil
}

func (g *fakeSharedGraph) Update(_ context.Context, u string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.updates = append(g.updates, u)
	if g.failWith != nil {
		return g.failWith
	}
	if strings.Contains(u, "a owl:Class") {
		g.classed = true
		return nil
	}
	if id, lit := nodeIDPattern.FindStringSubmatch(u), modelLiteralRe.FindStringSubmatch(u); id != nil && lit != nil {
		g.stored[id[1]] = lit[1]
	}
	return nil
}

func (g *fakeSharedGraph) lastUpdate() string { return g.updates[len(g.updates)-1] }

const validModel = `{"version":1,"root":{"classIri":"https://example.com/o#A","includeSubclasses":true},"hops":[],"filters":[],"columns":[],"sort":[],"namespaces":["https://example.com/o"]}`

func sharedRouter(g *fakeSharedGraph, ids ...string) (http.Handler, *SharedQueryHandler) {
	h := NewSharedQueryHandler(g, sharedNS)
	if len(ids) > 0 {
		next := 0
		h.newID = func() string { id := ids[next]; next++; return id }
	}
	r := chi.NewRouter()
	r.Post("/shared-queries", h.Create)
	r.Get("/shared-queries/{id}", h.Get)
	return r, h
}

func do(r http.Handler, method, path, body string, user *userjwt.User) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != nil {
		req = req.WithContext(context.WithValue(req.Context(), userContextKey{}, *user))
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func messageOf(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body %q is not JSON: %v", w.Body.String(), err)
	}
	return body.Message
}

func TestSharedQueryCreate_StampsUserAndIgnoresClientValues(t *testing.T) {
	g := newFakeSharedGraph()
	r, _ := sharedRouter(g)
	body := `{"model":` + validModel + `,"createdBy":"mallory","createdAt":"1998-01-01T00:00:00Z"}`
	w := do(r, http.MethodPost, "/shared-queries", body, &userjwt.User{Sub: "alice"})
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if !shortlinks.IsShortID(out.ID) {
		t.Fatalf("id = %q", out.ID)
	}
	u := g.lastUpdate()
	if !strings.Contains(u, `"alice"`) || strings.Contains(u, "mallory") || strings.Contains(u, "1998") {
		t.Errorf("update not stamped server-side: %s", u)
	}
	if g.stored[out.ID] != strings.ReplaceAll(validModel, `"`, `\"`) {
		t.Errorf("stored model = %s", g.stored[out.ID])
	}
}

func TestSharedQueryCreate_WritesTheSameSPARQLAsTheTSRoute(t *testing.T) {
	g := newFakeSharedGraph()
	r, h := sharedRouter(g, "aZ09aZ09aZ")
	h.now = func() string { return "2026-01-02T03:04:05.678Z" }
	w := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, &userjwt.User{Sub: `al"ice`})
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	const prefixes = "\nPREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nPREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX owl: <http://www.w3.org/2002/07/owl#>\nPREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\nPREFIX sh: <http://www.w3.org/ns/shacl#>\n"
	wantQueries := []string{
		prefixes + " ASK FROM <" + sharedSchema + "> { <" + sharedClass + "> a owl:Class }",
		prefixes + " ASK FROM <" + sharedSchema + "> { <" + sharedSchema + "#SharedQueryaZ09aZ09aZ> ?p ?o }",
	}
	// ensureSharedQueryClass runs once per insert attempt: class ASK, then the node ASK.
	if len(g.queries) != 2 {
		t.Fatalf("queries = %q", g.queries)
	}
	if g.queries[0] != wantQueries[0] || g.queries[1] != wantQueries[1] {
		t.Errorf("queries = %q\nwant %q", g.queries, wantQueries)
	}
	wantClass := prefixes + " INSERT DATA { GRAPH <" + sharedSchema + "> { <" + sharedClass + "> a owl:Class ; rdfs:label \"SharedQuery\" . } }"
	wantNode := prefixes + " INSERT DATA { GRAPH <" + sharedSchema + "> { <" + sharedSchema + "#SharedQueryaZ09aZ09aZ> a <" + sharedClass + "> ; <" + sharedSchema + "#queryModelJson> \"" + strings.ReplaceAll(validModel, `"`, `\"`) + "\" ; <" + sharedSchema + "#createdBy> \"al\\\"ice\" ; <" + sharedSchema + "#createdAt> \"2026-01-02T03:04:05.678Z\"^^xsd:dateTime . } }"
	if len(g.updates) != 2 || g.updates[0] != wantClass || g.updates[1] != wantNode {
		t.Errorf("updates:\n got  %q\n want %q / %q", g.updates, wantClass, wantNode)
	}
}

func TestSharedQueryCreate_AnonymousWritesNoCreatedBy(t *testing.T) {
	g := newFakeSharedGraph()
	r, _ := sharedRouter(g)
	w := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, nil)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if strings.Contains(g.lastUpdate(), "createdBy") {
		t.Errorf("anonymous create wrote createdBy: %s", g.lastUpdate())
	}
	if !strings.Contains(g.lastUpdate(), "createdAt") {
		t.Errorf("createdAt missing: %s", g.lastUpdate())
	}
}

func TestSharedQueryCreate_RejectsBadBodiesWithoutWriting(t *testing.T) {
	cases := []struct{ name, body, message string }{
		{"not json", "not json", "Request body must be a JSON object"},
		{"empty", "", "Request body must be a JSON object"},
		{"no model", `{}`, `Missing "model"`},
		{"model null", `{"model":null}`, `Missing "model"`},
		{"model string", `{"model":"x"}`, `Missing "model"`},
		{"body null", `null`, `Missing "model"`},
		{"body array", `[]`, `Missing "model"`},
		{"body number", `5`, `Missing "model"`},
		{"model array", `{"model":[]}`, "Query model must be a JSON object"},
		{"model without fields", `{"model":{"version":1}}`, "root must be { classIri: string, includeSubclasses: boolean }"},
		{"wrong version", `{"model":{"version":2}}`, "Unsupported query model version: 2"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := newFakeSharedGraph()
			r, _ := sharedRouter(g)
			w := do(r, http.MethodPost, "/shared-queries", c.body, nil)
			if w.Code != 400 {
				t.Fatalf("status = %d, want 400", w.Code)
			}
			if got := messageOf(t, w); got != c.message {
				t.Errorf("message = %q, want %q", got, c.message)
			}
			if len(g.updates)+len(g.queries) != 0 {
				t.Errorf("graph was touched: %q %q", g.queries, g.updates)
			}
		})
	}
}

func TestSharedQueryCreate_RejectsOversizedBody(t *testing.T) {
	g := newFakeSharedGraph()
	r, _ := sharedRouter(g)
	big := `{"model":` + validModel + `,"pad":"` + strings.Repeat("x", 250_000) + `"}`
	w := do(r, http.MethodPost, "/shared-queries", big, nil)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", w.Code)
	}
	if messageOf(t, w) != "The query is too large to share" {
		t.Errorf("message = %q", messageOf(t, w))
	}
	if len(g.updates) != 0 {
		t.Error("oversized body was written")
	}
}

func TestSharedQueryCreate_RetriesOnCollision(t *testing.T) {
	g := newFakeSharedGraph("takenAAAAA")
	r, _ := sharedRouter(g, "takenAAAAA", "freeBBBBBB")
	w := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, nil)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out.ID != "freeBBBBBB" {
		t.Errorf("id = %q", out.ID)
	}
	if _, ok := g.stored["takenAAAAA"]; ok {
		t.Error("collided id was written")
	}
}

func TestSharedQueryCreate_GivesUpAfterFiveCollisions(t *testing.T) {
	ids := []string{"takenAAAAA", "takenBBBBB", "takenCCCCC", "takenDDDDD", "takenEEEEE", "freeFFFFFF"}
	g := newFakeSharedGraph(ids[:5]...)
	r, _ := sharedRouter(g, ids...)
	w := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, nil)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
	if messageOf(t, w) != "Could not allocate a free link id, try again" {
		t.Errorf("message = %q", messageOf(t, w))
	}
	if _, ok := g.stored["freeFFFFFF"]; ok {
		t.Error("a sixth attempt was made")
	}
}

func TestSharedQueryCreate_GraphFailureIs502(t *testing.T) {
	g := newFakeSharedGraph()
	g.failWith = errors.New("GraphDB unreachable: boom")
	r, _ := sharedRouter(g)
	w := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, nil)
	if w.Code != http.StatusBadGateway || messageOf(t, w) != "GraphDB unreachable: boom" {
		t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
	}
}

func TestSharedQueryGet_ResolvesACreatedLink(t *testing.T) {
	g := newFakeSharedGraph()
	r, _ := sharedRouter(g)
	created := do(r, http.MethodPost, "/shared-queries", `{"model":`+validModel+`}`, nil)
	var out struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(created.Body.Bytes(), &out)

	w := do(r, http.MethodGet, "/shared-queries/"+out.ID, "", nil)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if got := strings.TrimSpace(w.Body.String()); got != `{"model":`+validModel+`}` {
		t.Errorf("body = %s", got)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content type = %q", ct)
	}
}

func TestSharedQueryGet_ResolvesALinkWrittenByTheTSRoute(t *testing.T) {
	g := newFakeSharedGraph()
	// Exactly the literal the TS route stores: serializeQueryModel(model), SPARQL-escaped.
	g.stored["oldLinkAAA"] = strings.ReplaceAll(validModel, `"`, `\"`)
	r, _ := sharedRouter(g)
	w := do(r, http.MethodGet, "/shared-queries/oldLinkAAA", "", nil)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"model":`+validModel+`}` {
		t.Errorf("status = %d, body = %s", w.Code, w.Body)
	}
}

func TestSharedQueryGet_MalformedIDNeverQueries(t *testing.T) {
	for _, id := range []string{"short", "aaaaaaaaaa%3E%20%7D%20DROP", "aaaaaaaaaa1", "%20"} {
		g := newFakeSharedGraph()
		r, _ := sharedRouter(g)
		w := do(r, http.MethodGet, "/shared-queries/"+id, "", nil)
		if w.Code != 404 || messageOf(t, w) != "The shared query was not found." {
			t.Errorf("%q: status = %d, message = %q", id, w.Code, messageOf(t, w))
		}
		if len(g.queries) != 0 {
			t.Errorf("%q ran a query: %q", id, g.queries)
		}
	}
}

func TestSharedQueryGet_UnknownID(t *testing.T) {
	r, _ := sharedRouter(newFakeSharedGraph())
	w := do(r, http.MethodGet, "/shared-queries/zzzzzzzzzz", "", nil)
	if w.Code != 404 || messageOf(t, w) != "The shared query was not found." {
		t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
	}
}

func TestSharedQueryGet_DamagedStoredModel(t *testing.T) {
	g := newFakeSharedGraph()
	g.stored["damagedAAA"] = `{\"version\":2}`
	r, _ := sharedRouter(g)
	w := do(r, http.MethodGet, "/shared-queries/damagedAAA", "", nil)
	if w.Code != 404 || messageOf(t, w) != "The shared query is damaged and could not be read." {
		t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
	}
}

func TestSharedQueryGet_GraphFailureIs502(t *testing.T) {
	g := newFakeSharedGraph()
	g.failWith = errors.New("GraphDB SELECT failed: status 500")
	r, _ := sharedRouter(g)
	w := do(r, http.MethodGet, "/shared-queries/aZ09aZ09aZ", "", nil)
	if w.Code != http.StatusBadGateway || messageOf(t, w) != "GraphDB SELECT failed: status 500" {
		t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
	}
}
