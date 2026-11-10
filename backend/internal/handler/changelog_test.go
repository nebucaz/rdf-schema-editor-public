package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/changelog"
)

type fakeChangeLog struct {
	adds   []changelog.Entry
	by, at string
	filter changelog.Filter
	err    error
}

func (f *fakeChangeLog) Add(_ context.Context, e changelog.Entry, by, at string) (string, error) {
	f.adds = append(f.adds, e)
	f.by, f.at = by, at
	return "urn:entry:1", f.err
}

func (f *fakeChangeLog) List(_ context.Context, fl changelog.Filter) ([]changelog.Item, error) {
	f.filter = fl
	return []changelog.Item{{IRI: "urn:entry:1", Summary: "s"}}, f.err
}

func changeLogRouter(svc *fakeChangeLog) http.Handler {
	h := NewChangeLogHandler(svc)
	h.now = func() string { return "2026-03-04T05:06:07.089Z" }
	r := chi.NewRouter()
	r.Post("/changelog", h.Create)
	r.Get("/changelog", h.List)
	return r
}

func TestChangeLogCreate_RequiresAUser(t *testing.T) {
	svc := &fakeChangeLog{}
	w := do(changeLogRouter(svc), http.MethodPost, "/changelog", `{"kind":"change","summary":"x"}`, nil)
	if w.Code != http.StatusUnauthorized || len(svc.adds) != 0 {
		t.Errorf("status = %d, adds = %d", w.Code, len(svc.adds))
	}
}

func TestChangeLogCreate_StampsAuthorAndTimeAndIgnoresClientValues(t *testing.T) {
	svc := &fakeChangeLog{}
	body := `{"kind":"change","summary":"x","changedBy":"mallory","changedAt":"1998-01-01T00:00:00Z"}`
	w := do(changeLogRouter(svc), http.MethodPost, "/changelog", body, alice)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if svc.by != "alice" || svc.at != "2026-03-04T05:06:07.089Z" {
		t.Errorf("stamped by %q at %q", svc.by, svc.at)
	}
	var out map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["iri"] != "urn:entry:1" || out["changedBy"] != "alice" || out["changedAt"] != svc.at {
		t.Errorf("response = %v", out)
	}
}

func TestChangeLogCreate_InputErrorsAre400AndGraphErrorsAre502(t *testing.T) {
	svc := &fakeChangeLog{}
	if w := do(changeLogRouter(svc), http.MethodPost, "/changelog", `[1]`, alice); w.Code != 400 {
		t.Errorf("non-object = %d", w.Code)
	}
	if w := do(changeLogRouter(&fakeChangeLog{err: errors.New("graphdb down")}), http.MethodPost, "/changelog", `{"kind":"change","summary":"x"}`, alice); w.Code != 502 {
		t.Errorf("graph error = %d", w.Code)
	}
}

func TestChangeLogList_PassesFilters(t *testing.T) {
	svc := &fakeChangeLog{}
	w := do(changeLogRouter(svc), http.MethodGet, "/changelog?term=urn:t&question=urn:q&version=1.0.0", "", alice)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if svc.filter != (changelog.Filter{Term: "urn:t", Question: "urn:q", Version: "1.0.0"}) {
		t.Errorf("filter = %+v", svc.filter)
	}
	if w := do(changeLogRouter(svc), http.MethodGet, "/changelog", "", nil); w.Code != 401 {
		t.Errorf("anonymous list = %d", w.Code)
	}
}
