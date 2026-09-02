package handler

import (
	"encoding/json"
	"net/http"
)

// HealthHandler serves the service health probe.
type HealthHandler struct{}

// Check returns {"status":"ok"} with HTTP 200. No authentication required — used to prove the
// binary starts, binds a port, and reads its own config without error.
func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
