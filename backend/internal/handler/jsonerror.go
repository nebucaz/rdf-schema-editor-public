package handler

import (
	"encoding/json"
	"net/http"
)

// writeJSONError replies with the `{"message": ...}` body the browser's SparqlConnector reads
// (`errorData.message`) — the shared error shape for every browser-facing route.
func writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}
