package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/handler"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

// TestNewRouter_HealthExemptFromAuth confirms STORY-002's exemption: /health must stay reachable
// with no Authorization header at all, matching docker-compose.yml's wget-based healthcheck.
func TestNewRouter_HealthExemptFromAuth(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "test-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))

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
	cfg := config.Config{AuthJWTSecret: secret, UserJWTSecret: "user-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))

	routes := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/sparql"},
		{http.MethodPost, "/sparql/update"},
		{http.MethodGet, "/sources/backstage/discover"},
		{http.MethodPost, "/sources/backstage/sync"},
		{http.MethodGet, "/validation/report"},
		{http.MethodPost, "/shared-queries"},
		{http.MethodGet, "/shared-queries/aZ09aZ09aZ"},
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
			userTok, _ := jwtauth.Mint("user-secret", "alice", time.Hour)
			req.AddCookie(&http.Cookie{Name: "Oglala", Value: userTok})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)

			if w.Code == http.StatusUnauthorized {
				t.Errorf("%s %s status = 401 with a valid token, want the auth middleware to let it through", route.method, route.path)
			}
		})
	}
}

// TestNewRouter_AnnotationsNeedServiceTokenAndUser confirms /annotations sits behind the service JWT
// and, on top of it, refuses a request that carries no verified user (STORY-009).
func TestNewRouter_AnnotationsNeedServiceTokenAndUser(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "svc-secret", UserJWTSecret: "user-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))
	svc, _ := jwtauth.Mint("svc-secret", "frontend-app", time.Hour)
	userTok, _ := jwtauth.Mint("user-secret", "alice", time.Hour)

	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		call := func(withService, withUser bool) *httptest.ResponseRecorder {
			req := httptest.NewRequest(method, "/annotations", strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			if withService {
				req.Header.Set("Authorization", "Bearer "+svc)
			}
			if withUser {
				req.AddCookie(&http.Cookie{Name: "Oglala", Value: userTok})
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			return w
		}
		if w := call(false, true); w.Code != http.StatusUnauthorized || strings.Contains(w.Body.String(), "Sign in required") {
			t.Errorf("%s without service token = %d %q, want the JWT middleware's 401", method, w.Code, w.Body.String())
		}
		if w := call(true, false); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "Sign in required") {
			t.Errorf("%s without user = %d %q, want the RequireUser 401", method, w.Code, w.Body.String())
		}
		if w := call(true, true); w.Code != http.StatusBadRequest {
			t.Errorf("%s with both = %d, want it to reach validation (400)", method, w.Code)
		}
	}
}

// TestNewRouter_CSRFGuardWired confirms a cross-site browser POST is rejected even with a valid
// service token, while the same request without browser headers reaches the handler (STORY-002).
func TestNewRouter_CSRFGuardWired(t *testing.T) {
	secret := "test-secret"
	cfg := config.Config{AuthJWTSecret: secret}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))
	token, _ := jwtauth.Mint(secret, "frontend-app", time.Hour)

	req := httptest.NewRequest(http.MethodPost, "/sparql/update", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-site POST status = %d, want 403", w.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/shared-queries", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-site POST /shared-queries status = %d, want 403", w.Code)
	}

	req = httptest.NewRequest(http.MethodDelete, "/annotations", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-site DELETE /annotations status = %d, want 403", w.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/sparql/update", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code == http.StatusForbidden || w.Code == http.StatusUnsupportedMediaType {
		t.Errorf("header-less POST status = %d, want it to reach the handler", w.Code)
	}
}

// TestNewRouter_MeReturnsUser confirms GET /me sits behind the service JWT and reports the user
// from a valid `Oglala` cookie (STORY-003).
func TestNewRouter_MeReturnsUser(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "svc-secret", UserJWTSecret: "user-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))

	req := httptest.NewRequest(http.MethodGet, "/me", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"user":null`) {
		t.Errorf("GET /me without service token or cookie = %d %q, want 200 with user null", w.Code, w.Body.String())
	}

	svc, _ := jwtauth.Mint("svc-secret", "frontend-app", time.Hour)
	userTok, _ := jwtauth.Mint("user-secret", "alice", time.Hour)
	req = httptest.NewRequest(http.MethodGet, "/me", nil)
	req.Header.Set("Authorization", "Bearer "+svc)
	req.AddCookie(&http.Cookie{Name: "Oglala", Value: userTok})
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"sub":"alice"`) {
		t.Errorf("GET /me = %d %q, want 200 with sub alice", w.Code, w.Body.String())
	}
}

// TestNewRouter_DevLoginRoutes confirms the dev-login routes exist only when enabled (STORY-005).
func TestNewRouter_DevLoginRoutes(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		cfg := config.Config{AuthJWTSecret: "svc-secret", UserJWTSecret: "user-secret", DevLoginEnabled: enabled}
		r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))

		// No service token: the button must work before any token is configured in dev.
		for _, path := range []string{"/auth/dev-login", "/auth/logout"} {
			req := httptest.NewRequest(http.MethodPost, path, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if enabled && w.Code != http.StatusOK {
				t.Errorf("enabled: POST %s = %d, want 200", path, w.Code)
			}
			if !enabled && w.Code != http.StatusNotFound {
				t.Errorf("disabled: POST %s = %d, want 404", path, w.Code)
			}
		}
	}
}

// TestNewRouter_ConfigIsPublic confirms GET /config needs no service token: it holds nothing secret and
// the frontend loads it before anything else.
func TestNewRouter_ConfigIsPublic(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "svc-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/config", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "devLoginEnabled") {
		t.Errorf("GET /config without token = %d %q, want 200 with the config", w.Code, w.Body.String())
	}
}

// TestNewRouter_DataRoutesNeedSignedInUser confirms a valid service token alone is not enough for the
// data routes: without a verified Oglala cookie they answer 401 "Sign in required". The Backstage
// sources routes are the exception — the sync worker and importctl have no user.
func TestNewRouter_DataRoutesNeedSignedInUser(t *testing.T) {
	cfg := config.Config{AuthJWTSecret: "svc-secret", UserJWTSecret: "user-secret"}
	r := newRouter(cfg, &handler.HealthHandler{}, handler.NewSparqlHandler(cfg), handler.NewSourceHandler(sync.NewRegistry(), nil, "", nil), handler.NewValidationHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"})), handler.NewSharedQueryHandler(graphdb.NewClient(config.Config{GraphDBEndpointURL: "http://unused"}), "https://example.com/o"), handler.NewAnnotationHandler(nil))
	svc, _ := jwtauth.Mint("svc-secret", "frontend-app", time.Hour)

	gated := []struct{ method, path string }{
		{http.MethodPost, "/sparql"},
		{http.MethodPost, "/sparql/update"},
		{http.MethodGet, "/validation/report"},
		{http.MethodPost, "/shared-queries"},
		{http.MethodGet, "/shared-queries/aZ09aZ09aZ"},
	}
	for _, route := range gated {
		req := httptest.NewRequest(route.method, route.path, nil)
		req.Header.Set("Authorization", "Bearer "+svc)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "Sign in required") {
			t.Errorf("%s %s without user = %d %q, want 401 Sign in required", route.method, route.path, w.Code, w.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/sources/backstage/discover", nil)
	req.Header.Set("Authorization", "Bearer "+svc)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code == http.StatusUnauthorized {
		t.Errorf("GET /sources/backstage/discover with only a service token = 401, want it reachable for importctl")
	}
}
