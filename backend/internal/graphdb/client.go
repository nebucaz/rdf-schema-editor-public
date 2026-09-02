// Package graphdb is a minimal internal SPARQL SELECT client for backend-side logic that needs to
// read the graph directly (e.g. sync.FetchKindMapping), as opposed to handler.SparqlHandler, which
// only proxies the app's own raw query/update bytes through unparsed. Same endpoint, same Basic
// auth, same GraphDB `infer=false` convention — a second, parsing client because callers here need
// bindings, not a byte stream to forward.
package graphdb

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
)

// Client runs SPARQL SELECT queries against GraphDB and parses the sparql-results+json response.
type Client struct {
	endpointURL string
	user        string
	password    string
	httpClient  *http.Client
}

// NewClient builds a Client from service config, mirroring handler.NewSparqlHandler.
func NewClient(cfg config.Config) *Client {
	return &Client{
		endpointURL: cfg.GraphDBEndpointURL,
		user:        cfg.GraphDBUser,
		password:    cfg.GraphDBPassword,
		httpClient:  &http.Client{},
	}
}

// Binding is one SPARQL-JSON binding value (e.g. {"type":"uri","value":"..."}).
type Binding struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// SelectResult is a parsed sparql-results+json SELECT response.
type SelectResult struct {
	Results struct {
		Bindings []map[string]Binding `json:"bindings"`
	} `json:"results"`
}

// askResult is a parsed sparql-results+json ASK response (`{"boolean": true}`).
type askResult struct {
	Boolean bool `json:"boolean"`
}

// Select runs a SPARQL SELECT query with `infer=false` (asserted statements only, matching this
// app's other whole-graph reads) and returns the parsed bindings.
func (c *Client) Select(ctx context.Context, query string) (SelectResult, error) {
	form := url.Values{"query": {query}, "infer": {"false"}}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpointURL, strings.NewReader(form.Encode()))
	if err != nil {
		return SelectResult{}, fmt.Errorf("build GraphDB request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	if c.user != "" && c.password != "" {
		credentials := base64.StdEncoding.EncodeToString([]byte(c.user + ":" + c.password))
		req.Header.Set("Authorization", "Basic "+credentials)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return SelectResult{}, fmt.Errorf("GraphDB unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return SelectResult{}, fmt.Errorf("GraphDB SELECT failed: status %d", resp.StatusCode)
	}

	var result SelectResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return SelectResult{}, fmt.Errorf("decode GraphDB response: %w", err)
	}
	return result, nil
}

// Ask runs a SPARQL ASK query with `infer=false` and returns its boolean result — used by
// sync.Engine's idempotent bootstrap checks (mirroring the app's own `askQuery`/`ASK`-then-INSERT
// convention, e.g. `ensureNamespaceClass`).
func (c *Client) Ask(ctx context.Context, query string) (bool, error) {
	form := url.Values{"query": {query}, "infer": {"false"}}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpointURL, strings.NewReader(form.Encode()))
	if err != nil {
		return false, fmt.Errorf("build GraphDB request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/sparql-results+json")
	if c.user != "" && c.password != "" {
		credentials := base64.StdEncoding.EncodeToString([]byte(c.user + ":" + c.password))
		req.Header.Set("Authorization", "Basic "+credentials)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("GraphDB unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("GraphDB ASK failed: status %d", resp.StatusCode)
	}

	var result askResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("decode GraphDB response: %w", err)
	}
	return result.Boolean, nil
}

// Update issues a raw SPARQL Update (INSERT DATA/DELETE WHERE/etc., possibly several `;`-separated
// operations) against GraphDB's `/statements` endpoint — the same request shape
// `handler.SparqlHandler.Update` forwards from the app, but called directly for backend-side writes
// (the sync engine's merge writer) rather than proxying a caller's bytes.
func (c *Client) Update(ctx context.Context, update string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpointURL+"/statements", strings.NewReader(update))
	if err != nil {
		return fmt.Errorf("build GraphDB request: %w", err)
	}
	req.Header.Set("Content-Type", "application/sparql-update")
	req.Header.Set("Accept", "application/json")
	if c.user != "" && c.password != "" {
		credentials := base64.StdEncoding.EncodeToString([]byte(c.user + ":" + c.password))
		req.Header.Set("Authorization", "Basic "+credentials)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("GraphDB unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GraphDB update failed: status %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
