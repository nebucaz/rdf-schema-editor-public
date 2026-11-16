package servicenow

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// defaultPageSize is the `sysparm_limit` of a list call.
const defaultPageSize = 100

// requestTimeout bounds one request; ServiceNow instances can be slow but never this slow.
const requestTimeout = 30 * time.Second

// ticketFields is projected on every read so a list stays small; `assigned_to.user_name` is dot-walked in
// the same call (verified on a developer instance), no second lookup.
const ticketFields = "sys_id,number,correlation_id,state,short_description,assignment_group,assigned_to,assigned_to.user_name,close_code,close_notes,active,sys_updated_on,sys_created_on,closed_at"

// Client talks to one ServiceNow instance. The base URL comes from Settings only, never from a request.
type Client struct {
	settings Settings
	http     *http.Client
	auth     authorizer
	now      func() time.Time
	pageSize int
}

// NewClient builds a Client. httpClient may be nil (a default with a timeout); tests pass the fake's.
func NewClient(s Settings, httpClient *http.Client) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: requestTimeout}
	}
	c := &Client{settings: s, http: httpClient, now: time.Now, pageSize: defaultPageSize}
	switch s.Auth {
	case AuthOAuth:
		o := &oauthAuth{httpClient: httpClient, tokenURL: s.BaseURL + "/oauth_token.do", id: s.ClientID, secret: s.ClientSecret}
		o.now = func() time.Time { return c.now() }
		c.auth = o
	default:
		c.auth = authorizerFunc(func() (string, string) { return c.settings.User, c.settings.Password })
	}
	return c
}

// authorizerFunc reads the Basic credentials at call time.
type authorizerFunc func() (string, string)

func (f authorizerFunc) Authorize(_ context.Context, req *http.Request) error {
	u, p := f()
	req.SetBasicAuth(u, p)
	return nil
}

func (authorizerFunc) Invalidate() {}

func (c *Client) tableURL(sysID string) string {
	u := c.settings.BaseURL + "/api/now/table/" + c.settings.Table
	if sysID != "" {
		u += "/" + url.PathEscape(sysID)
	}
	return u
}

// do sends one request, retrying once with a fresh token when the instance refuses the cached one.
func (c *Client) do(ctx context.Context, method, rawURL string, body any) ([]byte, error) {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return nil, err
		}
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, rawURL, bytes.NewReader(payload))
		if err != nil {
			return nil, fmt.Errorf("servicenow: build request")
		}
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json; charset=utf-8")
		}
		if err := c.auth.Authorize(ctx, req); err != nil {
			return nil, err
		}
		resp, err := c.http.Do(req)
		if err != nil {
			// the url.Error text carries the URL only, but keep the message generic anyway
			return nil, fmt.Errorf("%w: request failed", ErrUnavailable)
		}
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("%w: response cut off", ErrUnavailable)
		}
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			if _, isOAuth := c.auth.(*oauthAuth); isOAuth {
				c.auth.Invalidate()
				continue
			}
		}
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil, classify(resp.StatusCode, resp.Header, data)
		}
		return data, nil
	}
}

func readQuery(fields string) url.Values {
	return url.Values{"sysparm_display_value": {"all"}, "sysparm_fields": {fields}}
}

// CreateIncident creates one record from fields and returns it.
func (c *Client) CreateIncident(ctx context.Context, fields map[string]string) (Ticket, error) {
	u := c.tableURL("") + "?" + url.Values{"sysparm_display_value": {"all"}}.Encode()
	data, err := c.do(ctx, http.MethodPost, u, fields)
	if err != nil {
		return Ticket{}, err
	}
	return decodeOne(data)
}

// GetIncident reads one record by sys_id.
func (c *Client) GetIncident(ctx context.Context, sysID string) (Ticket, error) {
	data, err := c.do(ctx, http.MethodGet, c.tableURL(sysID)+"?"+readQuery(ticketFields).Encode(), nil)
	if err != nil {
		return Ticket{}, err
	}
	return decodeOne(data)
}

// UpdateIncident patches fields (state, close code and notes, work notes) and returns the record.
func (c *Client) UpdateIncident(ctx context.Context, sysID string, fields map[string]string) (Ticket, error) {
	data, err := c.do(ctx, http.MethodPatch, c.tableURL(sysID)+"?"+url.Values{"sysparm_display_value": {"all"}}.Encode(), fields)
	if err != nil {
		return Ticket{}, err
	}
	return decodeOne(data)
}

func checkPrefix(prefix string) error {
	if strings.ContainsAny(prefix, "^\n\r") {
		return fmt.Errorf("servicenow: invalid correlation prefix")
	}
	return nil
}

// FindByCorrelation returns every record whose correlation_id starts with prefix: the idempotency lookup
// before a create (`<findingId>` and its follow-ups `<findingId>-<n>`).
func (c *Client) FindByCorrelation(ctx context.Context, prefix string) ([]Ticket, error) {
	return c.list(ctx, prefix, time.Time{})
}

// ListUpdatedSince returns the records with that correlation prefix updated strictly after since (UTC),
// oldest first. A zero since returns all of them.
func (c *Client) ListUpdatedSince(ctx context.Context, prefix string, since time.Time) ([]Ticket, error) {
	return c.list(ctx, prefix, since)
}

func (c *Client) list(ctx context.Context, prefix string, since time.Time) ([]Ticket, error) {
	if err := checkPrefix(prefix); err != nil {
		return nil, err
	}
	var clauses []string
	if prefix != "" {
		clauses = append(clauses, "correlation_idSTARTSWITH"+prefix)
	}
	if !since.IsZero() {
		clauses = append(clauses, "sys_updated_on>"+FormatTimestamp(since))
	}
	clauses = append(clauses, "ORDERBYsys_updated_on")
	var all []Ticket
	for offset := 0; ; offset += c.pageSize {
		q := readQuery(ticketFields)
		q.Set("sysparm_query", strings.Join(clauses, "^"))
		q.Set("sysparm_limit", strconv.Itoa(c.pageSize))
		q.Set("sysparm_offset", strconv.Itoa(offset))
		data, err := c.do(ctx, http.MethodGet, c.tableURL("")+"?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		page, err := decodeMany(data)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if len(page) < c.pageSize {
			return all, nil
		}
	}
}
