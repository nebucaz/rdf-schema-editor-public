package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// withSubject builds a request carrying sub in context, exactly like JWTAuth would have placed it
// there on a successfully verified request.
func withSubject(r *http.Request, sub string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), subjectContextKey{}, sub))
}

func TestAuditLog_Success(t *testing.T) {
	var buf bytes.Buffer
	old := auditOut
	auditOut = &buf
	defer func() { auditOut = old }()

	req := withSubject(httptest.NewRequest(http.MethodPost, "/sparql", nil), "frontend-app")
	auditLog(req, "SELECT * WHERE { ?s ?p ?o }", http.StatusOK, "")

	var entry auditEntry
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("audit output is not valid JSON: %v (output: %q)", err, buf.String())
	}
	if entry.Caller != "frontend-app" {
		t.Errorf("Caller = %q, want frontend-app", entry.Caller)
	}
	if entry.Method != http.MethodPost || entry.Path != "/sparql" {
		t.Errorf("Method/Path = %s %s, want POST /sparql", entry.Method, entry.Path)
	}
	if entry.Status != http.StatusOK {
		t.Errorf("Status = %d, want 200", entry.Status)
	}
	if entry.Error != "" {
		t.Errorf("Error = %q, want empty on success", entry.Error)
	}
	if entry.Detail != "SELECT * WHERE { ?s ?p ?o }" {
		t.Errorf("Detail = %q, want the query text", entry.Detail)
	}
}

func TestAuditLog_Failure(t *testing.T) {
	var buf bytes.Buffer
	old := auditOut
	auditOut = &buf
	defer func() { auditOut = old }()

	req := withSubject(httptest.NewRequest(http.MethodPost, "/sparql/update", nil), "importctl")
	auditLog(req, "DROP GRAPH <urn:x>", http.StatusBadGateway, "GraphDB unreachable: connection refused")

	var entry auditEntry
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("audit output is not valid JSON: %v", err)
	}
	if entry.Caller != "importctl" {
		t.Errorf("Caller = %q, want importctl", entry.Caller)
	}
	if entry.Status != http.StatusBadGateway {
		t.Errorf("Status = %d, want 502", entry.Status)
	}
	if entry.Error != "GraphDB unreachable: connection refused" {
		t.Errorf("Error = %q, want the failure text", entry.Error)
	}
}

func TestAuditLog_SkippedWithoutVerifiedSubject(t *testing.T) {
	var buf bytes.Buffer
	old := auditOut
	auditOut = &buf
	defer func() { auditOut = old }()

	req := httptest.NewRequest(http.MethodPost, "/sparql", nil)
	auditLog(req, "SELECT * WHERE { ?s ?p ?o }", http.StatusOK, "")

	if buf.Len() != 0 {
		t.Errorf("audit output = %q, want no entry for a request with no verified subject in context", buf.String())
	}
}

func TestAuditLog_DetailTruncatedBeyondMaxLen(t *testing.T) {
	var buf bytes.Buffer
	old := auditOut
	auditOut = &buf
	defer func() { auditOut = old }()

	req := withSubject(httptest.NewRequest(http.MethodPost, "/sparql", nil), "frontend-app")
	longQuery := strings.Repeat("x", auditDetailMaxLen+50)
	auditLog(req, longQuery, http.StatusOK, "")

	var entry auditEntry
	if err := json.Unmarshal(bytes.TrimSpace(buf.Bytes()), &entry); err != nil {
		t.Fatalf("audit output is not valid JSON: %v", err)
	}
	if len(entry.Detail) > auditDetailMaxLen+len("…") {
		t.Errorf("Detail length = %d, want bounded to roughly %d", len(entry.Detail), auditDetailMaxLen)
	}
}
