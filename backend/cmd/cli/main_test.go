package main

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/jwtauth"
)

func TestRun_Discover_UnmappedKindsPresent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/sources/backstage/discover" {
			t.Errorf("path = %s, want /sources/backstage/discover", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"source":"backstage","unmappedKinds":["Domain","API"]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "API") || !strings.Contains(stdout.String(), "Domain") {
		t.Errorf("stdout missing unmapped kinds: %s", stdout.String())
	}
	if !strings.Contains(stdout.String(), "2 unmapped kinds") {
		t.Errorf("stdout missing summary count: %s", stdout.String())
	}
}

func TestRun_Discover_ZeroUnmappedKinds(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"source":"backstage","unmappedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0", code)
	}
	if !strings.Contains(stdout.String(), "No unmapped kinds") {
		t.Errorf("stdout = %q, want a no-unmapped-kinds message", stdout.String())
	}
}

func TestRun_Sync_DefaultsToDryRun(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		fmt.Fprint(w, `{"source":"backstage","dryRun":true,"syncedPerKind":{"Component":12},"mapping":{"Component":"core:Application"},"skippedKinds":["API"]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"sync", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotQuery != "dryRun=true" {
		t.Errorf("query = %q, want dryRun=true (default, no --apply)", gotQuery)
	}
	out := stdout.String()
	if !strings.Contains(out, "DRY RUN") {
		t.Errorf("stdout missing DRY RUN banner: %s", out)
	}
	if !strings.Contains(out, "Component") || !strings.Contains(out, "core:Application") || !strings.Contains(out, "12 individuals") {
		t.Errorf("stdout missing mapped-kind row: %s", out)
	}
	if !strings.Contains(out, "API") || !strings.Contains(out, "unmapped") {
		t.Errorf("stdout missing unmapped-kind row: %s", out)
	}
}

func TestRun_Sync_ApplyFlagSendsRealSync(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		fmt.Fprint(w, `{"source":"backstage","dryRun":false,"syncedPerKind":{},"mapping":{},"skippedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"sync", "backstage", "--apply", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotQuery != "dryRun=false" {
		t.Errorf("query = %q, want dryRun=false with --apply", gotQuery)
	}
	if !strings.Contains(stdout.String(), "SYNC APPLIED") {
		t.Errorf("stdout missing applied banner: %s", stdout.String())
	}
}

func TestRun_Sync_FlagAfterPositionalArg(t *testing.T) {
	var gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		fmt.Fprint(w, `{"source":"backstage","dryRun":false,"syncedPerKind":{},"mapping":{},"skippedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	// --apply comes after the positional "backstage" argument — must still be recognized.
	code := run([]string{"sync", "backstage", "--backend-url", server.URL, "--apply"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotQuery != "dryRun=false" {
		t.Errorf("query = %q, want dryRun=false", gotQuery)
	}
}

func TestRun_UnknownSourceReturns404AndNonZeroExit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unknown source: nope", http.StatusNotFound)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "nope", "--backend-url", server.URL}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero on backend 404")
	}
	if !strings.Contains(stderr.String(), "404") {
		t.Errorf("stderr = %q, want it to mention the 404 status", stderr.String())
	}
}

func TestRun_SyncConflictReturns409AndNonZeroExit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "sync already in progress", http.StatusConflict)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"sync", "backstage", "--apply", "--backend-url", server.URL}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero on backend 409")
	}
	if !strings.Contains(stderr.String(), "409") {
		t.Errorf("stderr = %q, want it to mention the 409 status", stderr.String())
	}
}

func TestRun_UpstreamUnreachableReturns502AndNonZeroExit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "discover upstream kinds: connection refused", http.StatusBadGateway)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero on backend 502")
	}
	if !strings.Contains(stderr.String(), "502") {
		t.Errorf("stderr = %q, want it to mention the 502 status", stderr.String())
	}
}

func TestRun_NeverHardcodesBackstageInRequestPath(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		fmt.Fprint(w, `{"source":"gitlab","unmappedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "gitlab", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotPath != "/sources/gitlab/discover" {
		t.Errorf("path = %s, want /sources/gitlab/discover — source name must come straight from the CLI arg", gotPath)
	}
}

func TestRun_Discover_AttachesBearerToken(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		fmt.Fprint(w, `{"source":"backstage","unmappedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "backstage", "--backend-url", server.URL, "--token", "test-jwt"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotAuth != "Bearer test-jwt" {
		t.Errorf("Authorization header = %q, want %q", gotAuth, "Bearer test-jwt")
	}
}

func TestRun_Sync_AttachesBearerTokenFromEnv(t *testing.T) {
	t.Setenv("IMPORTCTL_AUTH_TOKEN", "env-jwt")

	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		fmt.Fprint(w, `{"source":"backstage","dryRun":true,"syncedPerKind":{},"mapping":{},"skippedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"sync", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}
	if gotAuth != "Bearer env-jwt" {
		t.Errorf("Authorization header = %q, want %q", gotAuth, "Bearer env-jwt")
	}
}

func TestRun_Discover_MissingTokenSurfacesBackend401LikeAnyOtherError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		fmt.Fprint(w, `{"source":"backstage","unmappedKinds":[]}`)
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run([]string{"discover", "backstage", "--backend-url", server.URL}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero when the backend rejects a missing token")
	}
	if !strings.Contains(stderr.String(), "401") {
		t.Errorf("stderr = %q, want it to mention the 401 status, matching apiError's existing format", stderr.String())
	}
}

func TestRun_MintToken_ProducesValidJWT(t *testing.T) {
	t.Setenv("AUTH_JWT_SECRET", "test-secret")

	var stdout, stderr bytes.Buffer
	code := run([]string{"mint-token", "--sub", "frontend-app"}, &stdout, &stderr)

	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr.String())
	}

	token := strings.TrimSpace(stdout.String())
	sub, err := jwtauth.Verify(token, "test-secret")
	if err != nil {
		t.Fatalf("minted token did not verify: %v", err)
	}
	if sub != "frontend-app" {
		t.Errorf("sub = %q, want frontend-app", sub)
	}
}

func TestRun_MintToken_TTLOverride(t *testing.T) {
	t.Setenv("AUTH_JWT_SECRET", "test-secret")

	var stdout1, stderr1 bytes.Buffer
	code := run([]string{"mint-token", "--sub", "importctl", "--ttl", "1h"}, &stdout1, &stderr1)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr1.String())
	}

	// JWT NumericDate claims truncate to whole seconds, so the gap must exceed 1s for iat/exp to
	// actually differ between the two invocations.
	time.Sleep(1100 * time.Millisecond)

	var stdout2, stderr2 bytes.Buffer
	code = run([]string{"mint-token", "--sub", "importctl", "--ttl", "1h"}, &stdout2, &stderr2)
	if code != 0 {
		t.Fatalf("exit code = %d, want 0, stderr: %s", code, stderr2.String())
	}

	if stdout1.String() == stdout2.String() {
		t.Error("two mint-token invocations produced identical tokens, want iat/exp to differ per invocation")
	}
}

func TestRun_MintToken_MissingSubRequired(t *testing.T) {
	t.Setenv("AUTH_JWT_SECRET", "test-secret")

	var stdout, stderr bytes.Buffer
	code := run([]string{"mint-token"}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero when --sub is missing")
	}
	if !strings.Contains(stderr.String(), "--sub") {
		t.Errorf("stderr = %q, want it to mention --sub", stderr.String())
	}
}

func TestRun_MintToken_MissingSecret(t *testing.T) {
	t.Setenv("AUTH_JWT_SECRET", "")

	var stdout, stderr bytes.Buffer
	code := run([]string{"mint-token", "--sub", "frontend-app"}, &stdout, &stderr)

	if code == 0 {
		t.Error("exit code = 0, want non-zero when AUTH_JWT_SECRET is unset")
	}
	if !strings.Contains(stderr.String(), "AUTH_JWT_SECRET") {
		t.Errorf("stderr = %q, want it to mention AUTH_JWT_SECRET", stderr.String())
	}
}
