// Package handler holds this service's HTTP handlers.
package handler

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

// SparqlHandler forwards SPARQL query/update requests to GraphDB, mirroring exactly the contract
// app/src/routes/api/sparql/+server.ts and .../sparql/update/+server.ts used to speak directly to
// GraphDB with (form-encoded query/update params, GraphDB's `infer=false` extension, Basic auth
// built from configured credentials) — this is the seam those SvelteKit routes now call instead.
type SparqlHandler struct {
	endpointURL string
	user        string
	password    string
	client      *http.Client
}

// NewSparqlHandler builds a SparqlHandler from service config.
func NewSparqlHandler(cfg config.Config) *SparqlHandler {
	return &SparqlHandler{
		endpointURL: cfg.GraphDBEndpointURL,
		user:        cfg.GraphDBUser,
		password:    cfg.GraphDBPassword,
		client:      &http.Client{},
	}
}

func (h *SparqlHandler) setBasicAuth(req *http.Request) {
	if h.user != "" && h.password != "" {
		credentials := base64.StdEncoding.EncodeToString([]byte(h.user + ":" + h.password))
		req.Header.Set("Authorization", "Basic "+credentials)
	}
}

// Query handles POST /sparql — form-encoded `query` (and optional `infer=false`), forwarded to
// GraphDB's SPARQL protocol endpoint, returning its sparql-results+json response unchanged.
func (h *SparqlHandler) Query(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}

	query := r.FormValue("query")
	if strings.TrimSpace(query) == "" {
		http.Error(w, `Missing or invalid "query" parameter`, http.StatusBadRequest)
		return
	}

	form := url.Values{"query": {query}}
	if r.FormValue("infer") == "false" {
		form.Set("infer", "false")
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.endpointURL, strings.NewReader(form.Encode()))
	if err != nil {
		http.Error(w, "failed to build GraphDB request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	h.setBasicAuth(req)

	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, "GraphDB unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp, "application/sparql-results+json")
}

// Update handles POST /sparql/update — form-encoded `update`, forwarded to GraphDB's /statements
// endpoint as raw application/sparql-update content, matching GraphDB's SPARQL Update protocol.
func (h *SparqlHandler) Update(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "malformed request body", http.StatusBadRequest)
		return
	}

	update := r.FormValue("update")
	if strings.TrimSpace(update) == "" {
		http.Error(w, `Missing or invalid "update" parameter`, http.StatusBadRequest)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.endpointURL+"/statements", strings.NewReader(update))
	if err != nil {
		http.Error(w, "failed to build GraphDB request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/sparql-update")
	req.Header.Set("Accept", "application/json")
	h.setBasicAuth(req)

	resp, err := h.client.Do(req)
	if err != nil {
		http.Error(w, "GraphDB unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	proxyResponse(w, resp, "application/json")
}

// proxyResponse copies GraphDB's status code and body to the client verbatim, defaulting the
// Content-Type to fallback only if GraphDB didn't set one.
func proxyResponse(w http.ResponseWriter, resp *http.Response, fallbackContentType string) {
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = fallbackContentType
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
