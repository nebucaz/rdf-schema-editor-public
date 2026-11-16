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
	issueTrackerName        string
	issueTrackerEnabled     bool
	serviceNow              ServiceNowPublic
}

// ServiceNowPublic is the part of the ServiceNow settings the UI may see: whether the integration exists,
// its display name, the bulk cap and whether automatic sync runs. No URL, credential or table.
type ServiceNowPublic struct {
	Enabled     bool   `json:"enabled"`
	Name        string `json:"name"`
	BulkCap     int    `json:"bulkCap"`
	SyncEnabled bool   `json:"syncEnabled"`
}

// WithServiceNow sets the ServiceNow block of the reply; without it the integration reads as off.
func (h *ConfigHandler) WithServiceNow(p ServiceNowPublic) *ConfigHandler {
	h.serviceNow = p
	return h
}

// NewConfigHandler snapshots the public settings out of cfg.
func NewConfigHandler(cfg config.Config) *ConfigHandler {
	return &ConfigHandler{
		defaultNamespaceBaseIRI: cfg.DefaultNamespaceBaseIRI(),
		devLoginEnabled:         cfg.DevLoginEnabled,
		issueTrackerName:        cfg.IssueTrackerName,
		issueTrackerEnabled:     cfg.IssueTrackerURLTemplate != "",
	}
}

// Get replies `{"defaultNamespaceBaseIri", "devLoginEnabled", "issueTracker": {"name", "enabled"},
// "serviceNow": {"enabled", "name", "bulkCap", "syncEnabled"}}`. The tracker URL template itself is never exposed.
func (h *ConfigHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"defaultNamespaceBaseIri": h.defaultNamespaceBaseIRI,
		"devLoginEnabled":         h.devLoginEnabled,
		"issueTracker":            map[string]any{"name": h.issueTrackerName, "enabled": h.issueTrackerEnabled},
		"serviceNow":              h.serviceNow,
	})
}
