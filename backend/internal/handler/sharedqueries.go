package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/querymodel"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/shortlinks"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// SharedQueryGraph is the slice of the GraphDB client the shared-query routes use;
// *graphdb.Client satisfies it.
type SharedQueryGraph interface {
	Ask(ctx context.Context, query string) (bool, error)
	Select(ctx context.Context, query string) (graphdb.SelectResult, error)
	Update(ctx context.Context, update string) error
}

const maxIDAttempts = 5

// SharedQueryHandler serves short share links (`POST /shared-queries`, `GET /shared-queries/{id}`),
// ported from the SvelteKit routes of the same name. Models are stored as `SharedQuery` nodes in the
// default namespace's `/schema` graph.
type SharedQueryHandler struct {
	graph       SharedQueryGraph
	baseIRI     string
	schemaGraph string
	schemaNS    string // schemaGraph + "#", the prefix local vocabulary IRIs mint under

	newID func() string
	now   func() string
}

// NewSharedQueryHandler builds the handler for the namespace rooted at defaultNamespaceBaseIRI.
func NewSharedQueryHandler(graph SharedQueryGraph, defaultNamespaceBaseIRI string) *SharedQueryHandler {
	schema := sparqlsafe.NamespaceGraphs(defaultNamespaceBaseIRI).Schema
	return &SharedQueryHandler{
		graph:       graph,
		baseIRI:     defaultNamespaceBaseIRI,
		schemaGraph: schema,
		schemaNS:    schema + "#",
		newID:       shortlinks.NewShortID,
		now:         func() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") },
	}
}

func (h *SharedQueryHandler) classIRI() string { return h.schemaNS + "SharedQuery" }

// Create handles POST /shared-queries. The model is validated strictly; `createdBy` (the verified
// user's `sub`, when signed in) and `createdAt` are stamped here and any client values are ignored.
func (h *SharedQueryHandler) Create(w http.ResponseWriter, r *http.Request) {
	// A UTF-16 unit is at most 3 UTF-8 bytes, so this bound never cuts off a body within the cap.
	raw, err := io.ReadAll(io.LimitReader(r.Body, int64(shortlinks.MaxSharedModelBytes)*3+1))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	text := string(raw)
	if shortlinks.ExceedsMaxSharedModelBytes(text) {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "The query is too large to share")
		return
	}
	if !json.Valid(raw) {
		writeJSONError(w, http.StatusBadRequest, "Request body must be a JSON object")
		return
	}
	var body struct {
		Model json.RawMessage `json:"model"`
	}
	// A valid JSON body that is not an object (array, number, null...) simply has no model.
	_ = json.Unmarshal(raw, &body)
	if !isJSONObjectOrArray(body.Model) {
		writeJSONError(w, http.StatusBadRequest, `Missing "model"`)
		return
	}
	modelJSON, err := querymodel.Parse(string(body.Model))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	createdBy := ""
	if user, ok := UserFromRequest(r); ok {
		createdBy = user.Sub
	}
	for i := 0; i < maxIDAttempts; i++ {
		id := h.newID()
		inserted, err := h.insert(r.Context(), id, modelJSON, createdBy, h.now())
		if err != nil {
			writeJSONError(w, http.StatusBadGateway, err.Error())
			return
		}
		if inserted {
			writeJSON(w, map[string]string{"id": id})
			return
		}
	}
	writeJSONError(w, http.StatusServiceUnavailable, "Could not allocate a free link id, try again")
}

func isJSONObjectOrArray(raw json.RawMessage) bool {
	return len(raw) > 0 && (raw[0] == '{' || raw[0] == '[')
}

// insert stores a model under id; false (writing nothing) means the id is taken.
func (h *SharedQueryHandler) insert(ctx context.Context, id, modelJSON, createdBy, createdAt string) (bool, error) {
	if !shortlinks.IsShortID(id) {
		return false, fmt.Errorf("Invalid share id")
	}
	if err := h.ensureClass(ctx); err != nil {
		return false, err
	}
	iri := shortlinks.SharedQueryIRI(id, h.baseIRI)
	taken, err := h.graph.Ask(ctx, fmt.Sprintf("%s ASK FROM <%s> { <%s> ?p ?o }", sparqlsafe.Prefixes, h.schemaGraph, iri))
	if err != nil || taken {
		return false, err
	}
	by := ""
	if createdBy != "" {
		by = fmt.Sprintf(` ; <%screatedBy> "%s"`, h.schemaNS, sparqlsafe.EscapeString(createdBy))
	}
	triples := fmt.Sprintf(`<%s> a <%s> ; <%squeryModelJson> "%s"%s ; <%screatedAt> "%s"^^xsd:dateTime .`,
		iri, h.classIRI(), h.schemaNS, sparqlsafe.EscapeString(modelJSON), by, h.schemaNS, sparqlsafe.EscapeString(createdAt))
	err = h.graph.Update(ctx, fmt.Sprintf("%s INSERT DATA { GRAPH <%s> { %s } }", sparqlsafe.Prefixes, h.schemaGraph, triples))
	return err == nil, err
}

// ensureClass idempotently declares `SharedQuery` in the default namespace's `/schema` graph.
func (h *SharedQueryHandler) ensureClass(ctx context.Context) error {
	exists, err := h.graph.Ask(ctx, fmt.Sprintf("%s ASK FROM <%s> { <%s> a owl:Class }", sparqlsafe.Prefixes, h.schemaGraph, h.classIRI()))
	if err != nil || exists {
		return err
	}
	return h.graph.Update(ctx, fmt.Sprintf(`%s INSERT DATA { GRAPH <%s> { <%s> a owl:Class ; rdfs:label "SharedQuery" . } }`,
		sparqlsafe.Prefixes, h.schemaGraph, h.classIRI()))
}

// Get handles GET /shared-queries/{id}. A malformed id is rejected before any SPARQL runs.
func (h *SharedQueryHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	const notFound = "The shared query was not found."
	if !shortlinks.IsShortID(id) {
		writeJSONError(w, http.StatusNotFound, notFound)
		return
	}
	res, err := h.graph.Select(r.Context(), fmt.Sprintf("%s SELECT ?model FROM <%s> WHERE { <%s> a <%s> ; <%squeryModelJson> ?model }",
		sparqlsafe.Prefixes, h.schemaGraph, shortlinks.SharedQueryIRI(id, h.baseIRI), h.classIRI(), h.schemaNS))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, err.Error())
		return
	}
	if len(res.Results.Bindings) == 0 {
		writeJSONError(w, http.StatusNotFound, notFound)
		return
	}
	model, err := querymodel.Parse(res.Results.Bindings[0]["model"].Value)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "The shared query is damaged and could not be read.")
		return
	}
	writeJSON(w, map[string]json.RawMessage{"model": json.RawMessage(model)})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}
