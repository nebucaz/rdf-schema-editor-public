package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/preferences"
)

// PreferencesService is what the handler needs from *preferences.Service.
type PreferencesService interface {
	Get(ctx context.Context, user, key string) (json.RawMessage, error)
	Put(ctx context.Context, user, key string, value []byte, updatedAt string) error
}

// PreferencesHandler serves `GET`/`PUT /preferences/{key}`. The owner is always the verified cookie user's `sub`; a
// client-supplied user is never read.
type PreferencesHandler struct {
	svc PreferencesService
	now func() string
}

// NewPreferencesHandler builds the handler around svc.
func NewPreferencesHandler(svc PreferencesService) *PreferencesHandler {
	return &PreferencesHandler{svc: svc, now: func() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000Z") }}
}

func preferencesStatus(err error) int {
	switch {
	case preferences.IsTooLarge(err):
		return http.StatusRequestEntityTooLarge
	case preferences.IsInputError(err):
		return http.StatusBadRequest
	default:
		return http.StatusBadGateway
	}
}

// preferenceRequest checks the user and the key; the key check comes first so an unknown key is a 404 for everyone.
func preferenceRequest(w http.ResponseWriter, r *http.Request) (user, key string, ok bool) {
	u, signed := UserFromRequest(r)
	if !signed {
		writeJSONError(w, http.StatusUnauthorized, "Preferences require a signed-in user")
		return "", "", false
	}
	key = chi.URLParam(r, "key")
	if !preferences.IsAllowedKey(key) {
		writeJSONError(w, http.StatusNotFound, "Unknown preference")
		return "", "", false
	}
	return u.Sub, key, true
}

// Get handles GET /preferences/{key} → `{value}`, with `null` when nothing is stored.
func (h *PreferencesHandler) Get(w http.ResponseWriter, r *http.Request) {
	user, key, ok := preferenceRequest(w, r)
	if !ok {
		return
	}
	value, err := h.svc.Get(r.Context(), user, key)
	if err != nil {
		writeJSONError(w, preferencesStatus(err), err.Error())
		return
	}
	if value == nil {
		value = json.RawMessage("null")
	}
	writeJSON(w, map[string]json.RawMessage{"value": value})
}

// Put handles PUT /preferences/{key} with `{value}` and replaces the stored value.
func (h *PreferencesHandler) Put(w http.ResponseWriter, r *http.Request) {
	user, key, ok := preferenceRequest(w, r)
	if !ok {
		return
	}
	body, ok := readJSONObject(w, r)
	if !ok {
		return
	}
	value, present := body["value"]
	if !present || value == nil {
		writeJSONError(w, http.StatusBadRequest, `The request needs a "value"`)
		return
	}
	raw, _ := json.Marshal(value)
	at := h.now()
	if err := h.svc.Put(r.Context(), user, key, raw, at); err != nil {
		writeJSONError(w, preferencesStatus(err), err.Error())
		return
	}
	writeJSON(w, map[string]string{"updatedAt": at})
}
