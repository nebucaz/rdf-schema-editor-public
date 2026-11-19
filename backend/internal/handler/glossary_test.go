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

	"github.com/nebucaz/rdf-schema-editor/backend/internal/glossary"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

type noRowsGraph struct{}

func (noRowsGraph) Select(context.Context, string) (graphdb.SelectResult, error) {
	return graphdb.SelectResult{}, nil
}

type fakeGlossary struct {
	filter  glossary.Filter
	err     error
	empty   bool
	schemes []glossary.Scheme
}

func (f *fakeGlossary) Schemes(context.Context) ([]glossary.Scheme, error) {
	if f.empty {
		return []glossary.Scheme{}, f.err
	}
	return []glossary.Scheme{{ID: "Workforce", IRI: "http://e/vocab#Workforce", Title: "T"}}, f.err
}

func (f *fakeGlossary) Concepts(_ context.Context, fl glossary.Filter) (glossary.Page, error) {
	f.filter = fl
	if f.err != nil {
		return glossary.Page{}, f.err
	}
	if f.empty {
		return glossary.Page{Items: []glossary.Concept{}, Page: 1}, nil
	}
	return glossary.Page{Items: []glossary.Concept{{
		ID: "Nurse", IRI: "http://e/vocab#Nurse", PrefLabel: map[string]string{"en": "Nurse"},
		AltLabels: map[string][]string{}, Broader: []string{}, Narrower: []string{}, Related: []string{}, Mappings: []glossary.Mapping{},
		Example: []string{}, Notation: []string{},
	}}, Page: 1}, nil
}

func (f *fakeGlossary) Concept(_ context.Context, _ string) (glossary.Concept, error) {
	p, err := f.Concepts(context.Background(), glossary.Filter{})
	if err != nil {
		return glossary.Concept{}, err
	}
	return p.Items[0], nil
}

func glossaryRouter(f *fakeGlossary) http.Handler {
	h := NewGlossaryHandler(f)
	r := chi.NewRouter()
	r.Get("/glossary/schemes", h.Schemes)
	r.Get("/glossary/concepts", h.Concepts)
	r.Get("/glossary/concepts/{id}", h.Concept)
	return r
}

func get(h http.Handler, target, accept string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestGlossaryJSONAndTurtleHaveTheRightContentTypes(t *testing.T) {
	h := glossaryRouter(&fakeGlossary{})
	for _, target := range []string{"/glossary/concepts", "/glossary/schemes", "/glossary/concepts/Nurse"} {
		rec := get(h, target, "")
		if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
			t.Errorf("%s: %d %q", target, rec.Code, rec.Header().Get("Content-Type"))
		}
		ttl := get(h, target, "text/turtle")
		if ttl.Code != 200 || !strings.HasPrefix(ttl.Header().Get("Content-Type"), "text/turtle") || !strings.Contains(ttl.Body.String(), "@prefix skos:") {
			t.Errorf("%s turtle: %d %q", target, ttl.Code, ttl.Header().Get("Content-Type"))
		}
		viaParam := get(h, target+"?format=turtle", "application/json")
		if !strings.HasPrefix(viaParam.Header().Get("Content-Type"), "text/turtle") {
			t.Errorf("%s ?format=turtle ignored", target)
		}
	}
}

func TestGlossaryEmptyListsAreArrays(t *testing.T) {
	h := glossaryRouter(&fakeGlossary{empty: true})
	var page struct {
		Items []any `json:"items"`
	}
	if err := json.Unmarshal(get(h, "/glossary/concepts", "").Body.Bytes(), &page); err != nil || page.Items == nil {
		t.Errorf("items = %#v, %v", page.Items, err)
	}
	if body := get(h, "/glossary/schemes", "").Body.String(); !strings.Contains(body, `"items":[]`) {
		t.Errorf("schemes body = %s", body)
	}
}

func TestGlossaryPassesTheQueryParametersOn(t *testing.T) {
	f := &fakeGlossary{}
	get(glossaryRouter(f), "/glossary/concepts?scheme=Workforce&lang=de&modifiedSince=2026-01-01&page=2&pageSize=10", "")
	want := glossary.Filter{SchemeID: "Workforce", Lang: "de", ModifiedSince: "2026-01-01", Page: 2, PageSize: 10}
	if f.filter != want {
		t.Errorf("filter = %+v", f.filter)
	}
}

func TestGlossaryRejectsBadParametersAndFormats(t *testing.T) {
	h := glossaryRouter(&fakeGlossary{})
	for _, target := range []string{"/glossary/concepts?page=abc", "/glossary/concepts?pageSize=x", "/glossary/concepts?format=xml"} {
		if rec := get(h, target, ""); rec.Code != 400 {
			t.Errorf("%s = %d", target, rec.Code)
		}
	}
}

func TestGlossaryMapsServiceErrorsToStatuses(t *testing.T) {
	cases := map[string]struct {
		err  error
		want int
	}{
		"input":   {glossaryInput(), 400},
		"unknown": {errors.New("graphdb down"), 502},
	}
	for name, c := range cases {
		rec := get(glossaryRouter(&fakeGlossary{err: c.err}), "/glossary/concepts", "")
		if rec.Code != c.want || !strings.Contains(rec.Body.String(), `"message"`) {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body.String())
		}
	}
}

func glossaryInput() error {
	_, err := glossary.New(nil, "http://e", "http://e/schema#").Concepts(context.Background(), glossary.Filter{SchemeID: "a b"})
	return err
}

func TestGlossaryHasNoWriteRoutes(t *testing.T) {
	h := glossaryRouter(&fakeGlossary{})
	for _, m := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		req := httptest.NewRequest(m, "/glossary/concepts", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusMethodNotAllowed && rec.Code != http.StatusNotFound {
			t.Errorf("%s = %d", m, rec.Code)
		}
	}
}

func TestGlossaryUnknownConceptIs404AndABadIdIs400(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/glossary/concepts/{id}", NewGlossaryHandler(glossary.New(noRowsGraph{}, "http://e", "http://e/schema#")).Concept)
	if rec := get(r, "/glossary/concepts/Nobody", ""); rec.Code != 404 {
		t.Errorf("unknown = %d", rec.Code)
	}
	if rec := get(r, "/glossary/concepts/a%20b", ""); rec.Code != 400 {
		t.Errorf("bad id = %d", rec.Code)
	}
}

func TestGlossaryTurtlePagesTellWhetherThereIsMore(t *testing.T) {
	rec := get(glossaryRouter(&fakeGlossary{}), "/glossary/concepts?format=turtle", "")
	if rec.Header().Get("X-Has-More") != "false" {
		t.Errorf("X-Has-More = %q", rec.Header().Get("X-Has-More"))
	}
}
