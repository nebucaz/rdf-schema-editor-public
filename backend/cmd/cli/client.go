// Command cli (built as `importctl`) is a thin HTTP client over the Go backend's
// `/sources/{source}/discover`/`/sources/{source}/sync` routes (Story 011) — it holds no
// sync/discovery logic of its own, only request building and terminal-table formatting, so
// `backend/internal/sync` stays the single place that knows how to talk to an ingestion source.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// discoverResponse/syncResponse mirror handler.discoverResponse / sync.SyncSummary's JSON shape —
// duplicated here deliberately rather than importing the backend packages, since this binary talks
// to a *running* backend over HTTP, never in-process.
type discoverResponse struct {
	Source        string   `json:"source"`
	UnmappedKinds []string `json:"unmappedKinds"`
}

type syncResponse struct {
	Source                 string            `json:"source"`
	DryRun                 bool              `json:"dryRun"`
	SyncedPerKind          map[string]int    `json:"syncedPerKind"`
	Mapping                map[string]string `json:"mapping"`
	SkippedKinds           []string          `json:"skippedKinds"`
	FallbackNamespaceKinds []string          `json:"fallbackNamespaceKinds"`
	MappingFailures        []string          `json:"mappingFailures"`
	RepresentsFailures     []string          `json:"representsFailures"`
	SkippedRelations       []string          `json:"skippedRelations"`
	RepresentsSynced       int               `json:"representsSynced"`
	RelationsSynced        int               `json:"relationsSynced"`
}

// apiError is returned for any non-2xx backend response — callers print its Error() to stderr and
// exit non-zero (Story 011's AC: a backend error surfaces as a clear stderr message, never a stack
// trace or a swallowed error).
type apiError struct {
	status int
	body   string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("backend returned status %d: %s", e.status, e.body)
}

// apiClient is a thin HTTP client over the backend's source-parameterized routes. token, when set,
// is sent as `Authorization: Bearer <token>` on every request — importctl's own signed JWT
// (STORY-005), distinct from the frontend's, so the audit log (STORY-006) can tell them apart.
type apiClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func (c *apiClient) discover(ctx context.Context, source string) (discoverResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/sources/"+source+"/discover", nil)
	if err != nil {
		return discoverResponse{}, err
	}
	c.setAuth(req)
	var out discoverResponse
	if err := c.doJSON(req, &out); err != nil {
		return discoverResponse{}, err
	}
	return out, nil
}

func (c *apiClient) setAuth(req *http.Request) {
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// sync calls POST /sources/{source}/sync?dryRun=<dryRun>. Never omits the query parameter — Story
// 011's AC that a bare `sync <source>` always sends `dryRun=true` unless `--apply` is passed depends
// on this being explicit every time, not relying on the backend's own default.
func (c *apiClient) sync(ctx context.Context, source string, dryRun bool) (syncResponse, error) {
	url := fmt.Sprintf("%s/sources/%s/sync?dryRun=%v", c.baseURL, source, dryRun)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return syncResponse{}, err
	}
	c.setAuth(req)
	var out syncResponse
	if err := c.doJSON(req, &out); err != nil {
		return syncResponse{}, err
	}
	return out, nil
}

// raw calls GET /sources/{source}/raw/{kind} and returns the response body verbatim — a JSON array
// of the source's own undecoded entity envelopes, meant for direct printing/saving rather than
// further parsing here (unlike discover/sync, this CLI has no typed shape to decode it into).
func (c *apiClient) raw(ctx context.Context, source, kind string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/sources/"+source+"/raw/"+kind, nil)
	if err != nil {
		return nil, err
	}
	c.setAuth(req)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("backend unreachable at %s: %w", req.URL, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &apiError{status: resp.StatusCode, body: string(body)}
	}
	return body, nil
}

func (c *apiClient) doJSON(req *http.Request, out any) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("backend unreachable at %s: %w", req.URL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return &apiError{status: resp.StatusCode, body: string(body)}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
