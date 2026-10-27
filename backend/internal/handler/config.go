package handler

import (
	"encoding/json"
	"net/http"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

// ConfigHandler serves GET /config — the runtime settings a statically built frontend cannot read
// from a server of its own. Nothing secret belongs in the response.
type ConfigHandler struct {
	defaultNamespaceBaseIRI string
	devLoginEnabled         bool
}

// NewConfigHandler snapshots the public settings out of cfg.
func NewConfigHandler(cfg config.Config) *ConfigHandler {
	return &ConfigHandler{
		defaultNamespaceBaseIRI: cfg.DefaultNamespaceBaseIRI(),
		devLoginEnabled:         cfg.DevLoginEnabled,
	}
}

// Get replies `{"defaultNamespaceBaseIri", "devLoginEnabled"}`.
func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"defaultNamespaceBaseIri": h.defaultNamespaceBaseIRI,
		"devLoginEnabled":         h.devLoginEnabled,
	})
}
