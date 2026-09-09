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

// entityEnvelope is Backstage's standard entity shape (`{apiVersion, kind, metadata, spec,
// relations}`). Metadata.Annotations is decoded even though nothing in this package reads it yet —
// Story 105's `represents` mechanism reads `enterprise.catalog.iri` out of it via `sync.Entity`'s
// flattened field map (see flattenFields below).
type entityEnvelope struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Metadata   struct {
		UID         string            `json:"uid"`
		Name        string            `json:"name"`
		Namespace   string            `json:"namespace"`
		Description string            `json:"description"`
		Labels      map[string]string `json:"labels"`
		Annotations map[string]string `json:"annotations"`
		Tags        []string          `json:"tags"`
	} `json:"metadata"`
	Spec      map[string]json.RawMessage `json:"spec"`
	Relations []relationRef              `json:"relations"`
}

// relationRef is one entry of Backstage's `relations[]` array — `{"type": "ownedBy", "targetRef":
// "group:default/payments-team"}`, per the documented response shape (`backstage-dev-guide.md`'s
// Example 2). Consumed by Story 106, not this story.
type relationRef struct {
	Type      string `json:"type"`
	TargetRef string `json:"targetRef"`
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

// doQuery issues one GET /entities/by-query page request and returns the raw, still-open response
// body (caller must close it) — shared by queryPage (decodes into the typed entityEnvelope shape)
// and FetchRawEntities (decodes into json.RawMessage instead, preserving every field Backstage sent
// even ones this package doesn't model).
func (c *Client) doQuery(ctx context.Context, cursor string, opts QueryOptions) (*http.Response, error) {
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
		return nil, fmt.Errorf("build Backstage request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Backstage unreachable: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("Backstage returned status %d", resp.StatusCode)
	}
	return resp, nil
}

func (c *Client) queryPage(ctx context.Context, cursor string, opts QueryOptions) (queryResponse, error) {
	resp, err := c.doQuery(ctx, cursor, opts)
	if err != nil {
		return queryResponse{}, err
	}
	defer resp.Body.Close()

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

// FetchEntities pages through every entity of the given kind and maps each into sync.Entity. This is
// pure data-plumbing (Story 098) — it flattens `metadata.*`/`spec.*` into dotted-key maps and decodes
// `relations[]`, but makes no mapping decisions (`rse:sourceField`/`rse:sourceRelation`/`represents`
// interpretation is Story 101/105/106's concern, reading the shape this method produces).
func (c *Client) FetchEntities(ctx context.Context, kind string) ([]sync.Entity, error) {
	envelopes, err := c.fetchAll(ctx, QueryOptions{Filters: []string{"kind=" + kind}})
	if err != nil {
		return nil, err
	}

	entities := make([]sync.Entity, 0, len(envelopes))
	for _, e := range envelopes {
		fields, fieldLists := flattenFields(e)
		relations := make([]sync.Relation, 0, len(e.Relations))
		for _, r := range e.Relations {
			relations = append(relations, sync.Relation{Type: r.Type, TargetRef: r.TargetRef})
		}
		entities = append(entities, sync.Entity{
			UID:        e.Metadata.UID,
			Name:       e.Metadata.Name,
			Kind:       e.Kind,
			Fields:     fields,
			FieldLists: fieldLists,
			Relations:  relations,
			SourceRef:  entityTargetRef(e),
		})
	}
	return entities, nil
}

// rawQueryResponse mirrors queryResponse but leaves each item undecoded — every field Backstage sent
// for that entity, not just the ones entityEnvelope models (metadata/spec/relations plus anything
// this package doesn't know about yet).
type rawQueryResponse struct {
	Items    []json.RawMessage `json:"items"`
	PageInfo pageInfo          `json:"pageInfo"`
}

// FetchRawEntities pages through every entity of kind exactly as FetchEntities does, but returns each
// item's raw, undecoded JSON instead of mapping it into sync.Entity — a debugging escape hatch for
// answering "what did Backstage actually send" directly (e.g. confirming `relations[]` really is
// empty upstream, rather than present but dropped somewhere in FetchEntities' own mapping/
// rse:sourceRelation resolution). Implements sync.RawSource.
func (c *Client) FetchRawEntities(ctx context.Context, kind string) ([]json.RawMessage, error) {
	var all []json.RawMessage
	cursor := ""
	opts := QueryOptions{Filters: []string{"kind=" + kind}}
	for {
		resp, err := c.doQuery(ctx, cursor, opts)
		if err != nil {
			return nil, err
		}
		var page rawQueryResponse
		decodeErr := json.NewDecoder(resp.Body).Decode(&page)
		resp.Body.Close()
		if decodeErr != nil {
			return nil, fmt.Errorf("decode Backstage response: %w", decodeErr)
		}
		all = append(all, page.Items...)
		if page.PageInfo.NextCursor == "" {
			break
		}
		cursor = page.PageInfo.NextCursor
	}
	return all, nil
}

// entityTargetRef computes e's own identity in Backstage's `targetRef` scheme (STORY-106) —
// `kind:namespace/name`, e.g. `component:default/payments-service` — the exact shape a *different*
// entity's `relations[].targetRef` names this one by. The kind segment is lowercased (Backstage's
// own convention: `e.Kind` itself is `Component`/`Group`/..., but every `targetRef` spells it
// lowercase — see `backstage-dev-guide.md`'s worked example). Namespace defaults to `"default"` when
// the entity omits it, matching Backstage's own documented default.
func entityTargetRef(e entityEnvelope) string {
	namespace := e.Metadata.Namespace
	if namespace == "" {
		namespace = "default"
	}
	return strings.ToLower(e.Kind) + ":" + namespace + "/" + e.Metadata.Name
}

// flattenFields produces `sync.Entity`'s dotted-key field maps from one decoded envelope —
// `"metadata.description"`, `"metadata.labels.environment"`,
// `"metadata.annotations.enterprise.catalog.iri"`, `"spec.lifecycle"`, ... in fields (single-valued);
// `"metadata.tags"`, an array-valued `spec.*` key, ... in fieldLists (multi-valued, preserved as a
// slice rather than string-joined so Story 101's merge-write can turn each element into its own
// triple via this app's existing `repeatable` mechanism). `metadata.annotations`' values are copied
// verbatim, no trimming/normalization — Story 105 depends on reading `enterprise.catalog.iri` exactly
// as written.
func flattenFields(e entityEnvelope) (fields map[string]string, fieldLists map[string][]string) {
	fields = make(map[string]string)
	fieldLists = make(map[string][]string)

	if e.Metadata.Description != "" {
		fields["metadata.description"] = e.Metadata.Description
	}
	for k, v := range e.Metadata.Labels {
		fields["metadata.labels."+k] = v
	}
	for k, v := range e.Metadata.Annotations {
		fields["metadata.annotations."+k] = v
	}
	if len(e.Metadata.Tags) > 0 {
		fieldLists["metadata.tags"] = e.Metadata.Tags
	}

	for key, raw := range e.Spec {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			fields["spec."+key] = s
			continue
		}
		var arr []string
		if json.Unmarshal(raw, &arr) == nil {
			fieldLists["spec."+key] = arr
			continue
		}
		fields["spec."+key] = string(raw)
	}

	return fields, fieldLists
}
