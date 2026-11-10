package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/changelog"
)

// ChangeLogService is what the handler needs from *changelog.Service.
type ChangeLogService interface {
	Add(ctx context.Context, e changelog.Entry, changedBy, changedAt string) (string, error)
	List(ctx context.Context, f changelog.Filter) ([]changelog.Item, error)
}

// ChangeLogHandler serves `POST`/`GET /changelog`. As with annotations, the server stamps `changedBy`
// (the verified user's `sub`) and `changedAt`; any such fields in the request are ignored. The same
// accepted limitation applies: a caller posting straight to `/sparql/update` can still write any author.
type ChangeLogHandler struct {
	svc ChangeLogService
	now func() string
}

// NewChangeLogHandler builds the handler around svc.
func NewChangeLogHandler(svc ChangeLogService) *ChangeLogHandler {
	return &ChangeLogHandler{svc: svc, now: func() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }}
}

func changeLogStatus(err error) int {
	if changelog.IsInputError(err) {
		return http.StatusBadRequest
	}
	return http.StatusBadGateway
}

func signedIn(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, ok := UserFromRequest(r)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "The change log requires a signed-in user")
		return "", false
	}
	return user.Sub, true
}

// Create handles POST /changelog: an entry → `{iri, changedBy, changedAt}`.
func (h *ChangeLogHandler) Create(w http.ResponseWriter, r *http.Request) {
	by, ok := signedIn(w, r)
	if !ok {
		return
	}
	body, ok := readJSONObject(w, r)
	if !ok {
		return
	}
	raw, _ := json.Marshal(body)
	var entry changelog.Entry // has no author or time field, so those client values cannot be read
	if err := json.Unmarshal(raw, &entry); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid change log entry")
		return
	}
	at := h.now()
	iri, err := h.svc.Add(r.Context(), entry, by, at)
	if err != nil {
		writeJSONError(w, changeLogStatus(err), err.Error())
		return
	}
	writeJSON(w, map[string]string{"iri": iri, "changedBy": by, "changedAt": at})
}

// List handles GET /changelog?term=&question=&version=.
func (h *ChangeLogHandler) List(w http.ResponseWriter, r *http.Request) {
	if _, ok := signedIn(w, r); !ok {
		return
	}
	q := r.URL.Query()
	items, err := h.svc.List(r.Context(), changelog.Filter{Term: q.Get("term"), Question: q.Get("question"), Version: q.Get("version")})
	if err != nil {
		writeJSONError(w, changeLogStatus(err), err.Error())
		return
	}
	writeJSON(w, map[string]any{"entries": items})
}
