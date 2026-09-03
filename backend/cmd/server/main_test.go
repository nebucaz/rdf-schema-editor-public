package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/handler"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

// TestNewRouter_HealthExemptFromAuth confirms STORY-002's exemption: /health must stay reachable
// with no Authorization header at all, matching docker-compose.yml's wget-based healthcheck.
func TestNewRouter_HealthExemptFromAuth(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "test-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("GET /health status = %d, want %d", w.Code, http.StatusOK)
	}
}

// TestNewRouter_ProtectedRoutesRequireAuth confirms every non-health route the story lists is
// behind JWTAuth — a request with no token gets 401, one with a valid token reaches the handler
// (proven here by it returning something other than 401).
func TestNewRouter_ProtectedRoutesRequireAuth(t *testing.T) {
	secret := "test-secret"
	cfg := config.Config{AuthJWTSecret: secret}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil))

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/sparql"},
		{http.MethodPost, "/sparql/update"},
		{http.MethodGet, "/sources/backstage/discover"},
		{http.MethodPost, "/sources/backstage/sync"},
	}

	for _, route := range routes {
		t.Run(route.path+" without token", func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code != http.StatusUnauthorized {
				t.Errorf("%s %s status = %d, want %d", route.method, route.path, w.Code, http.StatusUnauthorized)
			}
		})
	}

	validToken, err := jwtauth.Mint(secret, "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}

	for _, route := range routes {
		t.Run(route.path+" with valid token", func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			req.Header.Set("Authorization", "Bearer "+validToken)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s %s status = 401 with a valid token, want the auth middleware to let it through", route.method, route.path)
			}
		})
	}
}
