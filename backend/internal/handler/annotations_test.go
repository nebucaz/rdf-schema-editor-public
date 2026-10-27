package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/annotations"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/userjwt"
)

type addCall struct {
	fact       annotations.Fact
	annotation annotations.Annotation
	by, at     string
}

type fakeAnnotationService struct {
	adds      []addCall
	deletes   []string
	addErr    error
	deleteErr error
}

func (f *fakeAnnotationService) Add(_ context.Context, fact annotations.Fact, a annotations.Annotation, by, at string) (string, error) {
	f.adds = append(f.adds, addCall{fact, a, by, at})
	if f.addErr != nil {
		return "", f.addErr
	}
	return "https://example.com/o#Annotation1", nil
}

func (f *fakeAnnotationService) Delete(_ context.Context, iri string) error {
	f.deletes = append(f.deletes, iri)
	return f.deleteErr
}

func annotationRouter(svc *fakeAnnotationService) http.Handler {
	h := NewAnnotationHandler(svc)
	h.now = func() string { return "2026-03-04T05:06:07.089Z" }
	r := chi.NewRouter()
	r.Post("/annotations", h.Create)
	r.Delete("/annotations", h.Delete)
	return r
}

var alice = &userjwt.User{Sub: "alice"}

const goodFact = `{"subjectIri":"https://example.com/o#app1","predicateIri":"https://example.com/o#lifecycle","object":{"kind":"literal","value":"Production"}}`

func TestAnnotationCreate_RequiresAUser(t *testing.T) {
	svc := &fakeAnnotationService{}
	w := do(annotationRouter(svc), http.MethodPost, "/annotations", `{"fact":`+goodFact+`,"annotation":{"type":"text","text":"x"}}`, nil)
	if w.Code != http.StatusUnauthorized || messageOf(t, w) != "Annotating requires a signed-in user" {
		t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
	}
	if len(svc.adds) != 0 {
		t.Error("an anonymous request reached the service")
	}
}

func TestAnnotationCreate_StampsAuthorAndTimeAndIgnoresClientValues(t *testing.T) {
	svc := &fakeAnnotationService{}
	body := `{"fact":` + goodFact + `,"annotation":{"type":"text","text":"checked","annotatedBy":"mallory","annotatedAt":"1998-01-01T00:00:00Z"},"annotatedBy":"mallory","annotatedAt":"1998-01-01T00:00:00Z"}`
	w := do(annotationRouter(svc), http.MethodPost, "/annotations", body, alice)
	if w.Code != 200 {
		t.Fatalf("status = %d: %s", w.Code, w.Body)
	}
	if len(svc.adds) != 1 {
		t.Fatalf("service called %d times", len(svc.adds))
	}
	got := svc.adds[0]
	if got.by != "alice" || got.at != "2026-03-04T05:06:07.089Z" {
		t.Errorf("stamped by %q at %q", got.by, got.at)
	}
	if got.annotation.Text != "checked" || got.fact.SubjectIRI != "https://example.com/o#app1" {
		t.Errorf("service got %+v", got)
	}
	var out map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	want := map[string]string{"iri": "https://example.com/o#Annotation1", "annotatedBy": "alice", "annotatedAt": "2026-03-04T05:06:07.089Z"}
	for k, v := range want {
		if out[k] != v {
			t.Errorf("response %s = %q, want %q", k, out[k], v)
		}
	}
}

func TestAnnotationCreate_BadInputIs400AndNeverReachesTheService(t *testing.T) {
	cases := []struct{ name, body, message string }{
		{"not json", "nope", "Request body must be a JSON object"},
		{"empty body", "", "Request body must be a JSON object"},
		{"array body", "[]", "Request body must be a JSON object"},
		{"null body", "null", "Request body must be a JSON object"},
		{"no fact", `{"annotation":{"type":"text","text":"x"}}`, `Missing or invalid "fact"`},
		{"bad fact", `{"fact":{"subjectIri":"a b"},"annotation":{"type":"text","text":"x"}}`, "Invalid subject IRI"},
		{"no annotation", `{"fact":` + goodFact + `}`, `Missing or invalid "annotation"`},
		{"empty text", `{"fact":` + goodFact + `,"annotation":{"type":"text","text":" "}}`, "Annotation text must not be empty"},
		{"fact is checked before annotation", `{"fact":{},"annotation":{}}`, "Invalid subject IRI"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			svc := &fakeAnnotationService{}
			w := do(annotationRouter(svc), http.MethodPost, "/annotations", c.body, alice)
			if w.Code != 400 || messageOf(t, w) != c.message {
				t.Errorf("status = %d, message = %q; want 400 %q", w.Code, messageOf(t, w), c.message)
			}
			if len(svc.adds) != 0 {
				t.Error("service was called")
			}
		})
	}
}

func TestAnnotationCreate_OversizedBodyIs413(t *testing.T) {
	svc := &fakeAnnotationService{}
	body := `{"fact":` + goodFact + `,"annotation":{"type":"text","text":"` + strings.Repeat("x", 300_000) + `"}}`
	w := do(annotationRouter(svc), http.MethodPost, "/annotations", body, alice)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want 413", w.Code)
	}
	if len(svc.adds) != 0 {
		t.Error("service was called")
	}
}

func TestAnnotationCreate_ServiceErrorsMapToStatus(t *testing.T) {
	body := `{"fact":` + goodFact + `,"annotation":{"type":"text","text":"x"}}`

	svc := &fakeAnnotationService{addErr: errors.New("The given IRI is not an annotation label")}
	_, inputErr := annotations.ParseAnnotation(map[string]any{"type": "nope"}) // an input error value
	svc.addErr = inputErr
	w := do(annotationRouter(svc), http.MethodPost, "/annotations", body, alice)
	if w.Code != 400 || messageOf(t, w) != inputErr.Error() {
		t.Errorf("input error: status = %d, message = %q", w.Code, messageOf(t, w))
	}

	svc = &fakeAnnotationService{addErr: errors.New("GraphDB unreachable: boom")}
	w = do(annotationRouter(svc), http.MethodPost, "/annotations", body, alice)
	if w.Code != http.StatusBadGateway || messageOf(t, w) != "GraphDB unreachable: boom" {
		t.Errorf("graph error: status = %d, message = %q", w.Code, messageOf(t, w))
	}
}

func TestAnnotationDelete(t *testing.T) {
	t.Run("requires a user", func(t *testing.T) {
		svc := &fakeAnnotationService{}
		w := do(annotationRouter(svc), http.MethodDelete, "/annotations", `{"iri":"https://example.com/o#A1"}`, nil)
		if w.Code != http.StatusUnauthorized || len(svc.deletes) != 0 {
			t.Errorf("status = %d, deletes = %v", w.Code, svc.deletes)
		}
	})
	t.Run("removes the annotation", func(t *testing.T) {
		svc := &fakeAnnotationService{}
		w := do(annotationRouter(svc), http.MethodDelete, "/annotations", `{"iri":"https://example.com/o#A1"}`, alice)
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"success":true}` {
			t.Errorf("status = %d, body = %s", w.Code, w.Body)
		}
		if len(svc.deletes) != 1 || svc.deletes[0] != "https://example.com/o#A1" {
			t.Errorf("deletes = %v", svc.deletes)
		}
	})
	t.Run("rejects bad bodies and unsafe IRIs", func(t *testing.T) {
		for body, msg := range map[string]string{
			"nope":                  "Request body must be a JSON object",
			`{}`:                    "Invalid annotation IRI",
			`{"iri":""}`:            "Invalid annotation IRI",
			`{"iri":5}`:             "Invalid annotation IRI",
			`{"iri":"a> } DROP {"}`: "Invalid annotation IRI",
		} {
			svc := &fakeAnnotationService{}
			w := do(annotationRouter(svc), http.MethodDelete, "/annotations", body, alice)
			if w.Code != 400 || messageOf(t, w) != msg || len(svc.deletes) != 0 {
				t.Errorf("%q: status = %d, message = %q", body, w.Code, messageOf(t, w))
			}
		}
	})
	t.Run("a failing graph is 502", func(t *testing.T) {
		svc := &fakeAnnotationService{deleteErr: errors.New("GraphDB update failed: status 500")}
		w := do(annotationRouter(svc), http.MethodDelete, "/annotations", `{"iri":"https://example.com/o#A1"}`, alice)
		if w.Code != http.StatusBadGateway || messageOf(t, w) != "GraphDB update failed: status 500" {
			t.Errorf("status = %d, message = %q", w.Code, messageOf(t, w))
		}
	})
}
