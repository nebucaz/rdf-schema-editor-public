package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/glossary"
)

// GlossaryService is what the handler needs from *glossary.Service.
type GlossaryService interface {
	Schemes(ctx context.Context) ([]glossary.Scheme, error)
	Concepts(ctx context.Context, f glossary.Filter) (glossary.Page, error)
	Concept(ctx context.Context, id string) (glossary.Concept, error)
}

// GlossaryHandler serves the read-only glossary API (`/glossary/*`, skos-support STORY-428) to other tools. It is
// registered behind the service JWT only: no user, no write route, no SPARQL.
type GlossaryHandler struct{ svc GlossaryService }

// NewGlossaryHandler builds the handler around svc.
func NewGlossaryHandler(svc GlossaryService) *GlossaryHandler { return &GlossaryHandler{svc: svc} }

const turtleType = "text/turtle; charset=utf-8"

// wantsTurtle decides the format: `?format=` wins over `Accept`; JSON is the default. ok is false for an unknown format.
func wantsTurtle(r *http.Request) (turtle, ok bool) {
	switch f := strings.ToLower(r.URL.Query().Get("format")); f {
	case "turtle", "ttl":
		return true, true
	case "json":
		return false, true
	case "":
		return strings.Contains(r.Header.Get("Accept"), "text/turtle"), true
	}
	return false, false
}

func glossaryStatus(err error) int {
	switch {
	case glossary.IsInputError(err):
		return http.StatusBadRequest
	case glossary.IsNotFound(err):
		return http.StatusNotFound
	}
	return http.StatusBadGateway
}

func glossaryFail(w http.ResponseWriter, r *http.Request, err error) {
	status := glossaryStatus(err)
	auditLog(r, "glossary", status, err.Error())
	msg := err.Error()
	if status == http.StatusBadGateway {
		msg = "the vocabulary could not be read"
	}
	writeJSONError(w, status, msg)
}

func glossaryJSON(w http.ResponseWriter, r *http.Request, body any) {
	auditLog(r, "glossary", http.StatusOK, "")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func glossaryTurtle(w http.ResponseWriter, r *http.Request, body string) {
	auditLog(r, "glossary", http.StatusOK, "")
	w.Header().Set("Content-Type", turtleType)
	_, _ = w.Write([]byte(body))
}

// formatOf answers 400 itself for an unknown format.
func formatOf(w http.ResponseWriter, r *http.Request) (turtle, ok bool) {
	turtle, ok = wantsTurtle(r)
	if !ok {
		auditLog(r, "glossary", http.StatusBadRequest, "unknown format")
		writeJSONError(w, http.StatusBadRequest, "format must be json or turtle")
	}
	return turtle, ok
}

// Schemes handles GET /glossary/schemes.
func (h *GlossaryHandler) Schemes(w http.ResponseWriter, r *http.Request) {
	turtle, ok := formatOf(w, r)
	if !ok {
		return
	}
	schemes, err := h.svc.Schemes(r.Context())
	if err != nil {
		glossaryFail(w, r, err)
		return
	}
	if schemes == nil {
		schemes = []glossary.Scheme{}
	}
	if turtle {
		glossaryTurtle(w, r, glossary.Turtle(schemes, nil))
		return
	}
	glossaryJSON(w, r, map[string]any{"items": schemes})
}

func intParam(r *http.Request, name string) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return 0, nil
	}
	return strconv.Atoi(raw)
}

// Concepts handles GET /glossary/concepts?scheme=&lang=&modifiedSince=&page=&pageSize=.
func (h *GlossaryHandler) Concepts(w http.ResponseWriter, r *http.Request) {
	turtle, ok := formatOf(w, r)
	if !ok {
		return
	}
	page, perr := intParam(r, "page")
	size, serr := intParam(r, "pageSize")
	if perr != nil || serr != nil {
		auditLog(r, "glossary", http.StatusBadRequest, "page and pageSize must be numbers")
		writeJSONError(w, http.StatusBadRequest, "page and pageSize must be numbers")
		return
	}
	q := r.URL.Query()
	res, err := h.svc.Concepts(r.Context(), glossary.Filter{
		SchemeID: q.Get("scheme"), Lang: q.Get("lang"), ModifiedSince: q.Get("modifiedSince"), Page: page, PageSize: size,
	})
	if err != nil {
		glossaryFail(w, r, err)
		return
	}
	if res.Items == nil {
		res.Items = []glossary.Concept{}
	}
	w.Header().Set("X-Has-More", strconv.FormatBool(res.HasMore))
	if turtle {
		glossaryTurtle(w, r, glossary.Turtle(nil, res.Items))
		return
	}
	glossaryJSON(w, r, res)
}

// Concept handles GET /glossary/concepts/{id}.
func (h *GlossaryHandler) Concept(w http.ResponseWriter, r *http.Request) {
	turtle, ok := formatOf(w, r)
	if !ok {
		return
	}
	c, err := h.svc.Concept(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		glossaryFail(w, r, err)
		return
	}
	if turtle {
		glossaryTurtle(w, r, glossary.Turtle(nil, []glossary.Concept{c}))
		return
	}
	glossaryJSON(w, r, c)
}
