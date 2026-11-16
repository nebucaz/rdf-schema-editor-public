package servicenow

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// tokenMargin refreshes an OAuth token this long before it expires.
const tokenMargin = 30 * time.Second

// authorizer signs a request. Invalidate drops anything cached, after the instance refused a token.
type authorizer interface {
	Authorize(ctx context.Context, req *http.Request) error
	Invalidate()
}

// oauthAuth is the OAuth 2.0 client-credentials grant against `<base>/oauth_token.do`, with the token
// cached until shortly before it expires.
type oauthAuth struct {
	httpClient *http.Client
	tokenURL   string
	id, secret string
	now        func() time.Time

	mu      sync.Mutex
	token   string
	expires time.Time
}

func (o *oauthAuth) Authorize(ctx context.Context, req *http.Request) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.token == "" || !o.now().Before(o.expires.Add(-tokenMargin)) {
		if err := o.fetch(ctx); err != nil {
			return err
		}
	}
	req.Header.Set("Authorization", "Bearer "+o.token)
	return nil
}

func (o *oauthAuth) Invalidate() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.token = ""
}

func (o *oauthAuth) fetch(ctx context.Context) error {
	form := url.Values{"grant_type": {"client_credentials"}, "client_id": {o.id}, "client_secret": {o.secret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("servicenow: build token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := o.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w: token endpoint unreachable", ErrUnavailable)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode >= 500 {
			return fmt.Errorf("%w: token endpoint status %d", ErrUnavailable, resp.StatusCode)
		}
		return &ErrRejected{Message: fmt.Sprintf("OAuth token request refused (status %d)", resp.StatusCode), Status: resp.StatusCode}
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil || tok.AccessToken == "" {
		return &ErrRejected{Message: "OAuth token response is unreadable", Status: resp.StatusCode}
	}
	o.token = tok.AccessToken
	o.expires = o.now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	return nil
}
