package handler

import (
	"encoding/json"
	"net/http"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/validation"
)

// ValidationHandler serves GET /validation/report (STORY-130) — mirrors SourceHandler's thin,
// GraphDB-client-holding shape exactly. No request body/query parameters in v1 (plan.md's explicit
// "no ?class=/?namespace= scoping in this plan" note): the route always runs the full,
// all-namespaces check.
type ValidationHandler struct {
	gdb *graphdb.Client
}

// NewValidationHandler builds a ValidationHandler.
func NewValidationHandler(gdb *graphdb.Client) *ValidationHandler {
	return &ValidationHandler{gdb: gdb}
}

// Report handles GET /validation/report: loads a fresh validation.ValidationSnapshot, checks it,
// and returns the resulting violation list as a JSON array — `[]` (never `null`) when there are
// zero violations, per Decision 4's "transient only, recomputed every run" ADR (nothing is written
// back to GraphDB, nothing cached).
func (h *ValidationHandler) Report(w http.ResponseWriter, r *http.Request) {
	snapshot, err := validation.LoadValidationSnapshot(r.Context(), h.gdb)
	if err != nil {
		auditLog(r, "", http.StatusBadGateway, "load validation snapshot: "+err.Error())
		http.Error(w, "load validation snapshot: "+err.Error(), http.StatusBadGateway)
		return
	}

	violations := validation.CheckSnapshot(snapshot)
	if violations == nil {
		violations = []validation.Violation{}
	}

	auditLog(r, "", http.StatusOK, "")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(violations)
}
