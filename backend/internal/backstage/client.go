// Package backstage implements sync.Source against Backstage's (the CNCF software catalog)
// documented `GET /entities/by-query` API — the first ingestion source (spec/report/plan.md,
// Story 003). No live Backstage instance is assumed available yet; tests run against fixture/canned
// HTTP responses matching the documented response shape.
package backstage

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

// defaultLimit is the page size requested when QueryOptions.Limit is unset.
const defaultLimit = 20

// entityEnvelope is Backstage's standard entity shape (`{apiVersion, kind, metadata, spec}`).
type entityEnvelope struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Metadata   struct {
		UID  string `json:"uid"`
		Name string `json:"name"`
	} `json:"metadata"`
	Spec map[string]json.RawMessage `json:"spec"`
}

type pageInfo struct {
	NextCursor string `json:"nextCursor"`
	PrevCursor string `json:"prevCursor"`
}

type queryResponse struct {
	Items      []entityEnvelope `json:"items"`
	TotalItems int              `json:"totalItems"`
	PageInfo   pageInfo         `json:"pageInfo"`
}

// QueryOptions narrows a `GET /entities/by-query` call. Filters are repeatable `key=value` strings,
// ANDed together (Backstage's own `filter` query-param contract); Fields projects the response down
// to only the named top-level fields (e.g. `["kind"]` for cheap discovery); Limit overrides the
// default page size.
type QueryOptions struct {
	Filters []string
	Fields  []string
	Limit   int
}

// Client is a Backstage `GET /entities/by-query` client, and implements sync.Source directly.
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

// NewClient builds a Client. token may be empty for an unauthenticated catalog.
func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		token:      token,
		httpClient: &http.Client{},
	}
}

// Name identifies this source in sync.Registry.
func (c *Client) Name() string { return "backstage" }

func (c *Client) queryPage(ctx context.Context, cursor string, opts QueryOptions) (queryResponse, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = defaultLimit
	}

	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	for _, filter := range opts.Filters {
		q.Add("filter", filter)
	}
	if len(opts.Fields) > 0 {
		q.Set("fields", strings.Join(opts.Fields, ","))
	}

	reqURL := c.baseURL + "/entities/by-query?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return queryResponse{}, fmt.Errorf("build Backstage request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return queryResponse{}, fmt.Errorf("Backstage unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return queryResponse{}, fmt.Errorf("Backstage returned status %d", resp.StatusCode)
	}

	var out queryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return queryResponse{}, fmt.Errorf("decode Backstage response: %w", err)
	}
	return out, nil
}

// fetchAll pages through queryPage to completion, following `pageInfo.nextCursor` until empty.
func (c *Client) fetchAll(ctx context.Context, opts QueryOptions) ([]entityEnvelope, error) {
	var all []entityEnvelope
	cursor := ""
	for {
		page, err := c.queryPage(ctx, cursor, opts)
		if err != nil {
			return nil, err
		}
		all = append(all, page.Items...)
		if page.PageInfo.NextCursor == "" {
			break
		}
		cursor = page.PageInfo.NextCursor
	}
	return all, nil
}

// DiscoverKinds collects the distinct `kind` values present in the live catalog, requesting only
// `fields=kind` — no full-entity fetch needed for discovery (Story 004).
func (c *Client) DiscoverKinds(ctx context.Context) ([]string, error) {
	envelopes, err := c.fetchAll(ctx, QueryOptions{Fields: []string{"kind"}})
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var kinds []string
	for _, e := range envelopes {
		if e.Kind == "" || seen[e.Kind] {
			continue
		}
		seen[e.Kind] = true
		kinds = append(kinds, e.Kind)
	}
	return kinds, nil
}

// FetchEntities pages through every entity of the given kind and maps each into sync.Entity.
// `spec` fields are flattened to strings: string values pass through verbatim, anything else is its
// raw JSON text — good enough until a real sync/merge engine (Story 007) needs richer typing.
func (c *Client) FetchEntities(ctx context.Context, kind string) ([]sync.Entity, error) {
	envelopes, err := c.fetchAll(ctx, QueryOptions{Filters: []string{"kind=" + kind}})
	if err != nil {
		return nil, err
	}

	entities := make([]sync.Entity, 0, len(envelopes))
	for _, e := range envelopes {
		attributes := make(map[string]string, len(e.Spec))
		for key, raw := range e.Spec {
			var s string
			if json.Unmarshal(raw, &s) == nil {
				attributes[key] = s
			} else {
				attributes[key] = string(raw)
			}
		}
		entities = append(entities, sync.Entity{
			UID:        e.Metadata.UID,
			Name:       e.Metadata.Name,
			Kind:       e.Kind,
			Attributes: attributes,
		})
	}
	return entities, nil
}
