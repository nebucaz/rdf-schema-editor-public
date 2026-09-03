package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
)

const testSecret = "test-signing-secret"

func TestJWTAuth(t *testing.T) {
	validToken, err := jwtauth.Mint(testSecret, "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}
	expiredToken, err := jwtauth.Mint(testSecret, "frontend-app", -time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}
	wrongSecretToken, err := jwtauth.Mint("some-other-secret", "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}

	tests := []struct {
		name       string
		authHeader string
		wantStatus int
		wantSub    string
	}{
		{name: "valid token", authHeader: "Bearer " + validToken, wantStatus: http.StatusOK, wantSub: "frontend-app"},
		{name: "missing header", authHeader: "", wantStatus: http.StatusUnauthorized},
		{name: "malformed header, no Bearer prefix", authHeader: validToken, wantStatus: http.StatusUnauthorized},
		{name: "bad signature", authHeader: "Bearer " + wrongSecretToken, wantStatus: http.StatusUnauthorized},
		{name: "expired token", authHeader: "Bearer " + expiredToken, wantStatus: http.StatusUnauthorized},
		{name: "garbage token", authHeader: "Bearer not-a-jwt", wantStatus: http.StatusUnauthorized},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotSub string
			var nextCalled bool
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				gotSub, _ = SubjectFromContext(r.Context())
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/sparql", nil)
			if tt.authHeader != "" {
				req.Header.Set("Authorization", tt.authHeader)
			}
			w := httptest.NewRecorder()

			JWTAuth(testSecret)(next).ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if tt.wantStatus == http.StatusOK {
				if !nextCalled {
					t.Error("next handler was not called for a valid token")
				}
				if gotSub != tt.wantSub {
					t.Errorf("sub in context = %q, want %q", gotSub, tt.wantSub)
				}
			} else if nextCalled {
				t.Error("next handler was called despite an invalid token")
			}
		})
	}
}
