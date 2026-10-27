package handler

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/annotations"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

// maxAnnotationBodyBytes bounds a request body; a legitimate one is two IRIs, a literal and at most
// 2000 characters of text.
const maxAnnotationBodyBytes = 256 * 1024

// AnnotationService is what the handler needs from *annotations.Service.
type AnnotationService interface {
	Add(ctx context.Context, fact annotations.Fact, annotation annotations.Annotation, annotatedBy, annotatedAt string) (string, error)
	Delete(ctx context.Context, annotationIRI string) error
}

// AnnotationHandler serves `POST`/`DELETE /annotations`, ported from the SvelteKit route. The
// server — not the browser — stamps `annotatedBy` (the verified user's `sub`) and `annotatedAt`;
// any such fields in the request are ignored.
//
// Accepted limitation: the backend stays a SPARQL passthrough, so a caller who posts straight to
// `/sparql/update` can still write any author. This route gives correct attribution for the normal
// UI, not a security boundary.
type AnnotationHandler struct {
	svc AnnotationService
	now func() string
}

// NewAnnotationHandler builds the handler around svc.
func NewAnnotationHandler(svc AnnotationService) *AnnotationHandler {
	return &AnnotationHandler{svc: svc, now: func() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }}
}

// requireUser writes the 401 and returns false when nobody is signed in.
func requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, ok := UserFromRequest(r)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "Annotating requires a signed-in user")
		return "", false
	}
	return user.Sub, true
}

// readJSONObject decodes the request body, which must be a JSON object.
func readJSONObject(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxAnnotationBodyBytes+1))
	if err == nil && len(raw) > maxAnnotationBodyBytes {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "The request is too large")
		return nil, false
	}
	var body map[string]any
	if err != nil || json.Unmarshal(raw, &body) != nil || body == nil {
		writeJSONError(w, http.StatusBadRequest, "Request body must be a JSON object")
		return nil, false
	}
	return body, true
}

// Create handles POST /annotations: `{fact, annotation}` → `{iri, annotatedBy, annotatedAt}`.
func (h *AnnotationHandler) Create(w http.ResponseWriter, r *http.Request) {
	by, ok := requireUser(w, r)
	if !ok {
		return
	}
	body, ok := readJSONObject(w, r)
	if !ok {
		return
	}
	fact, err := annotations.ParseFact(body["fact"])
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}
	annotation, err := annotations.ParseAnnotation(body["annotation"])
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Client-supplied author/timestamp are deliberately never read.
	at := h.now()
	iri, err := h.svc.Add(r.Context(), fact, annotation, by, at)
	if err != nil {
		writeJSONError(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, map[string]string{"iri": iri, "annotatedBy": by, "annotatedAt": at})
}

// Delete handles DELETE /annotations: `{iri}` → `{success: true}`. Only nodes typed `Annotation`
// can be removed this way.
func (h *AnnotationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUser(w, r); !ok {
		return
	}
	body, ok := readJSONObject(w, r)
	if !ok {
		return
	}
	iri, ok := body["iri"].(string)
	if !ok || iri == "" || !sparqlsafe.SafeIRI(iri) {
		writeJSONError(w, http.StatusBadRequest, "Invalid annotation IRI")
		return
	}
	if err := h.svc.Delete(r.Context(), iri); err != nil {
		writeJSONError(w, statusFor(err), err.Error())
		return
	}
	writeJSON(w, map[string]bool{"success": true})
}

// statusFor maps a service error: bad input is the caller's (400), anything else is GraphDB's (502).
func statusFor(err error) int {
	if annotations.IsInputError(err) {
		return http.StatusBadRequest
	}
	return http.StatusBadGateway
}
