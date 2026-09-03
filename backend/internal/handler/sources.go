package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

// SourceHandler serves the source-parameterized ingestion routes (`GET /sources/{source}/discover`,
// `POST /sources/{source}/sync`) — resolving `{source}` against a sync.Registry rather than
// hardcoding Backstage, per the plan's confirmed near-term second-source goal.
type SourceHandler struct {
	registry                  *sync.Registry
	gdb                       *graphdb.Client
	backstageKindPredicateIRI string
	engine                    *sync.Engine
}

// NewSourceHandler builds a SourceHandler.
func NewSourceHandler(registry *sync.Registry, gdb *graphdb.Client, backstageKindPredicateIRI string, engine *sync.Engine) *SourceHandler {
	return &SourceHandler{registry: registry, gdb: gdb, backstageKindPredicateIRI: backstageKindPredicateIRI, engine: engine}
}

type discoverResponse struct {
	Source        string   `json:"source"`
	UnmappedKinds []string `json:"unmappedKinds"`
}

// Discover handles GET /sources/{source}/discover: the named source's upstream kinds, minus the
// kinds already mapped to a local class in the graph (Story 004).
func (h *SourceHandler) Discover(w http.ResponseWriter, r *http.Request) {
	sourceName := chi.URLParam(r, "source")
	source, ok := h.registry.Get(sourceName)
	if !ok {
		auditLog(r, sourceName, http.StatusNotFound, "unknown source")
		http.Error(w, "unknown source: "+sourceName, http.StatusNotFound)
		return
	}

	kinds, err := source.DiscoverKinds(r.Context())
	if err != nil {
		auditLog(r, sourceName, http.StatusBadGateway, "discover upstream kinds: "+err.Error())
		http.Error(w, "discover upstream kinds: "+err.Error(), http.StatusBadGateway)
		return
	}

	mapping, err := sync.FetchKindMapping(r.Context(), h.gdb, h.backstageKindPredicateIRI)
	if err != nil {
		auditLog(r, sourceName, http.StatusBadGateway, "fetch kind mapping: "+err.Error())
		http.Error(w, "fetch kind mapping: "+err.Error(), http.StatusBadGateway)
		return
	}

	unmapped := make([]string, 0, len(kinds))
	for _, kind := range kinds {
		if _, mapped := mapping[kind]; !mapped {
			unmapped = append(unmapped, kind)
		}
	}

	auditLog(r, sourceName, http.StatusOK, "")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(discoverResponse{Source: sourceName, UnmappedKinds: unmapped})
}

// Sync handles POST /sources/{source}/sync?dryRun=true|false — triggers an immediate RunSync
// (Story 007) and returns its summary synchronously (Story 008). `dryRun` defaults to false.
func (h *SourceHandler) Sync(w http.ResponseWriter, r *http.Request) {
	sourceName := chi.URLParam(r, "source")
	source, ok := h.registry.Get(sourceName)
	if !ok {
		auditLog(r, sourceName, http.StatusNotFound, "unknown source")
		http.Error(w, "unknown source: "+sourceName, http.StatusNotFound)
		return
	}

	dryRun := r.URL.Query().Get("dryRun") == "true"

	summary, err := h.engine.RunSync(r.Context(), source, dryRun)
	if err != nil {
		if errors.Is(err, sync.ErrSyncInProgress) {
			auditLog(r, sourceName, http.StatusConflict, "a real sync is already in progress")
			http.Error(w, "a real sync is already in progress for source: "+sourceName, http.StatusConflict)
			return
		}
		auditLog(r, sourceName, http.StatusBadGateway, "run sync: "+err.Error())
		http.Error(w, "run sync: "+err.Error(), http.StatusBadGateway)
		return
	}

	auditLog(r, sourceName, http.StatusOK, "")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(summary)
}
