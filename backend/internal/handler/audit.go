package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"time"
)

// auditOut is where every audit entry is written — stdout by default (STORY-006's ADR: composes
// with chimiddleware.Logger's existing stdout convention rather than replacing it). Tests
// substitute this to capture output instead of writing to the real process stdout.
var auditOut io.Writer = os.Stdout

// auditDetailMaxLen bounds the SPARQL query/update text captured in an audit entry's Detail
// field — this is a prefix for "what was attempted", not a byte-exact replay log, so an
// arbitrarily large query doesn't bloat every log line.
const auditDetailMaxLen = 500

// auditEntry is the structured JSON shape written per authenticated request — distinct from
// chimiddleware.Logger's own method/path/status line, and keyed by the verified caller identity
// STORY-002's middleware placed in request context.
type auditEntry struct {
	Timestamp string `json:"timestamp"`
	Caller    string `json:"caller"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Detail    string `json:"detail,omitempty"`
	Status    int    `json:"status"`
	Error     string `json:"error,omitempty"`
}

// auditLog emits one structured JSON line for a request that reached a protected handler. detail
// is a route-specific summary (the SPARQL query/update text for the two SPARQL routes, the source
// name for the two source routes); errText is non-empty only on failure. Requests with no verified
// `sub` in context are silently skipped — an unauthenticated 401 never reaches a handler that
// calls this, and has no real identity to attach anyway (chimiddleware.Logger already covers it).
func auditLog(r *http.Request, detail string, status int, errText string) {
	sub, ok := SubjectFromContext(r.Context())
	if !ok {
		return
	}

	if len(detail) > auditDetailMaxLen {
		detail = detail[:auditDetailMaxLen] + "…"
	}

	entry := auditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Caller:    sub,
		Method:    r.Method,
		Path:      r.URL.Path,
		Detail:    detail,
		Status:    status,
		Error:     errText,
	}

	b, err := json.Marshal(entry)
	if err != nil {
		return
	}
	_, _ = auditOut.Write(append(b, '\n'))
}
