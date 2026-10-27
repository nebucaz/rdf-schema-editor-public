// Package handler holds this service's HTTP handlers.
package handler

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"mime"
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
	params, err := readSparqlParams(r)
	if err != nil {
		auditLog(r, "", http.StatusBadRequest, "malformed request body")
		writeJSONError(w, http.StatusBadRequest, "malformed request body")
		return
	}

	query := params.query
	if strings.TrimSpace(query) == "" {
		auditLog(r, "", http.StatusBadRequest, `Missing or invalid "query" parameter`)
		writeJSONError(w, http.StatusBadRequest, `Missing or invalid "query" parameter`)
		return
	}

	form := url.Values{"query": {query}}
	if params.inferOff {
		form.Set("infer", "false")
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.endpointURL, strings.NewReader(form.Encode()))
	if err != nil {
		auditLog(r, query, http.StatusInternalServerError, "failed to build GraphDB request")
		writeJSONError(w, http.StatusInternalServerError, "failed to build GraphDB request")
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	h.setBasicAuth(req)

	resp, err := h.client.Do(req)
	if err != nil {
		auditLog(r, query, http.StatusBadGateway, "GraphDB unreachable: "+err.Error())
		writeJSONError(w, http.StatusBadGateway, "GraphDB unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	auditLog(r, query, resp.StatusCode, "")
	proxyResponse(w, resp, "application/sparql-results+json")
}

// Update handles POST /sparql/update — form-encoded `update`, forwarded to GraphDB's /statements
// endpoint as raw application/sparql-update content, matching GraphDB's SPARQL Update protocol.
func (h *SparqlHandler) Update(w http.ResponseWriter, r *http.Request) {
	params, err := readSparqlParams(r)
	if err != nil {
		auditLog(r, "", http.StatusBadRequest, "malformed request body")
		writeJSONError(w, http.StatusBadRequest, "malformed request body")
		return
	}

	update := params.update
	if strings.TrimSpace(update) == "" {
		auditLog(r, "", http.StatusBadRequest, `Missing or invalid "update" parameter`)
		writeJSONError(w, http.StatusBadRequest, `Missing or invalid "update" parameter`)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, h.endpointURL+"/statements", strings.NewReader(update))
	if err != nil {
		auditLog(r, update, http.StatusInternalServerError, "failed to build GraphDB request")
		writeJSONError(w, http.StatusInternalServerError, "failed to build GraphDB request")
		return
	}
	req.Header.Set("Content-Type", "application/sparql-update")
	req.Header.Set("Accept", "application/json")
	h.setBasicAuth(req)

	resp, err := h.client.Do(req)
	if err != nil {
		auditLog(r, update, http.StatusBadGateway, "GraphDB unreachable: "+err.Error())
		writeJSONError(w, http.StatusBadGateway, "GraphDB unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	auditLog(r, update, resp.StatusCode, "")
	proxyResponse(w, resp, "application/json")
}

// sparqlParams is the decoded request body of POST /sparql and /sparql/update.
type sparqlParams struct {
	query    string
	update   string
	inferOff bool
}

// readSparqlParams decodes either the browser's JSON body (`{query, infer?}` / `{update}`) or the
// form-encoded body non-browser callers (importctl) send.
func readSparqlParams(r *http.Request) (sparqlParams, error) {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType == "application/json" {
		var body struct {
			Query  any `json:"query"`
			Update any `json:"update"`
			Infer  any `json:"infer"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return sparqlParams{}, err
		}
		q, _ := body.Query.(string)
		u, _ := body.Update.(string)
		return sparqlParams{query: q, update: u, inferOff: body.Infer == false}, nil
	}
	if err := r.ParseForm(); err != nil {
		return sparqlParams{}, err
	}
	return sparqlParams{query: r.FormValue("query"), update: r.FormValue("update"), inferOff: r.FormValue("infer") == "false"}, nil
}

// proxyResponse copies GraphDB's status code and body to the client verbatim, defaulting the
// Content-Type to fallback only if GraphDB didn't set one.
func proxyResponse(w http.ResponseWriter, resp *http.Response, fallbackContentType string) {
	if resp.StatusCode >= 400 {
		// GraphDB's error body is plain text; the browser contract is `{"message"}` with the same status.
		body, _ := io.ReadAll(resp.Body)
		message := strings.TrimSpace(string(body))
		if message == "" {
			message = http.StatusText(resp.StatusCode)
		}
		writeJSONError(w, resp.StatusCode, message)
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = fallbackContentType
	}
	w.Header().Set("Content-Type", contentType)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
