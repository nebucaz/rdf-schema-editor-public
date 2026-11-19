package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/preferences"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

type fakePrefs struct {
	byUser map[string]json.RawMessage
	putBy  string
	putAt  string
	err    error
}

func (f *fakePrefs) Get(_ context.Context, user, key string) (json.RawMessage, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byUser[user+"/"+key], nil
}

func (f *fakePrefs) Put(_ context.Context, user, key string, value []byte, at string) error {
	if f.err != nil {
		return f.err
	}
	if !preferences.IsAllowedKey(key) {
		return errors.New("unreachable: the handler checks the key first")
	}
	if f.byUser == nil {
		f.byUser = map[string]json.RawMessage{}
	}
	f.byUser[user+"/"+key] = value
	f.putBy, f.putAt = user, at
	return nil
}

func prefsRouter(svc PreferencesService, guard bool) http.Handler {
	h := NewPreferencesHandler(svc)
	h.now = func() string { return "2026-03-04T05:06:07.089Z" }
	r := chi.NewRouter()
	if guard {
		r.Use(CSRFGuard(nil))
	}
	r.Get("/preferences/{key}", h.Get)
	r.Put("/preferences/{key}", h.Put)
	return r
}

func TestPreferencesGet_ReturnsNullThenTheValueOfTheSignedInUserOnly(t *testing.T) {
	svc := &fakePrefs{byUser: map[string]json.RawMessage{"bob/ontology-dashboard": json.RawMessage(`{"u":"bob"}`)}}
	r := prefsRouter(svc, false)
	w := do(r, http.MethodGet, "/preferences/ontology-dashboard", "", alice)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"value":null}` {
		t.Errorf("alice: %d %s", w.Code, w.Body)
	}
	w = do(r, http.MethodGet, "/preferences/ontology-dashboard", "", &userjwt.User{Sub: "bob"})
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"value":{"u":"bob"}}` {
		t.Errorf("bob: %d %s", w.Code, w.Body)
	}
}

func TestPreferencesPut_StoresForTheVerifiedUserAndIgnoresAClientUser(t *testing.T) {
	svc := &fakePrefs{}
	w := do(prefsRouter(svc, false), http.MethodPut, "/preferences/ontology-dashboard", `{"value":{"order":["a"]},"user":"mallory"}`, alice)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if svc.putBy != "alice" || svc.putAt != "2026-03-04T05:06:07.089Z" || string(svc.byUser["alice/ontology-dashboard"]) != `{"order":["a"]}` {
		t.Errorf("by=%q at=%q stored=%v", svc.putBy, svc.putAt, svc.byUser)
	}
}

func TestPreferences_RequireAUser(t *testing.T) {
	svc := &fakePrefs{}
	r := prefsRouter(svc, false)
	if w := do(r, http.MethodGet, "/preferences/ontology-dashboard", "", nil); w.Code != 401 {
		t.Errorf("get = %d", w.Code)
	}
	if w := do(r, http.MethodPut, "/preferences/ontology-dashboard", `{"value":{}}`, nil); w.Code != 401 || svc.byUser != nil {
		t.Errorf("put = %d", w.Code)
	}
}

func TestPreferences_BadRequestsGetAMessage(t *testing.T) {
	r := prefsRouter(&fakePrefs{}, false)
	for name, c := range map[string]struct {
		method, path, body string
		status             int
	}{
		"unknown key on get": {http.MethodGet, "/preferences/nope", "", 404},
		"unknown key on put": {http.MethodPut, "/preferences/nope", `{"value":{}}`, 404},
		"not an object":      {http.MethodPut, "/preferences/ontology-dashboard", `[1]`, 400},
		"not json":           {http.MethodPut, "/preferences/ontology-dashboard", `{`, 400},
		"no value":           {http.MethodPut, "/preferences/ontology-dashboard", `{}`, 400},
		"null value":         {http.MethodPut, "/preferences/ontology-dashboard", `{"value":null}`, 400},
	} {
		w := do(r, c.method, c.path, c.body, alice)
		if w.Code != c.status || messageOf(t, w) == "" {
			t.Errorf("%s: status = %d body = %s", name, w.Code, w.Body)
		}
	}
}

type nopGraph struct{}

func (nopGraph) Update(context.Context, string) error { return nil }
func (nopGraph) Select(context.Context, string) (graphdb.SelectResult, error) {
	return graphdb.SelectResult{}, nil
}

func TestPreferencesPut_AnOversizeValueIs413WithTheRealService(t *testing.T) {
	r := prefsRouter(preferences.New(nopGraph{}, "http://example.org/o"), false)
	w := do(r, http.MethodPut, "/preferences/ontology-dashboard", `{"value":"`+strings.Repeat("x", preferences.MaxValueBytes)+`"}`, alice)
	if w.Code != http.StatusRequestEntityTooLarge || messageOf(t, w) == "" {
		t.Errorf("status = %d body = %s", w.Code, w.Body)
	}
}

func TestPreferences_GraphErrorsAre502(t *testing.T) {
	r := prefsRouter(&fakePrefs{err: errors.New("graphdb down")}, false)
	if w := do(r, http.MethodGet, "/preferences/ontology-dashboard", "", alice); w.Code != 502 {
		t.Errorf("get = %d", w.Code)
	}
	if w := do(r, http.MethodPut, "/preferences/ontology-dashboard", `{"value":{}}`, alice); w.Code != 502 {
		t.Errorf("put = %d", w.Code)
	}
}

func TestPreferencesPut_IsCSRFGuarded(t *testing.T) {
	svc := &fakePrefs{}
	req := httptest.NewRequest(http.MethodPut, "/preferences/ontology-dashboard", strings.NewReader(`{"value":{}}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req = req.WithContext(context.WithValue(req.Context(), userContextKey{}, *alice))
	w := httptest.NewRecorder()
	prefsRouter(svc, true).ServeHTTP(w, req)
	if w.Code != http.StatusForbidden || svc.byUser != nil {
		t.Errorf("status = %d, stored = %v", w.Code, svc.byUser)
	}
}
