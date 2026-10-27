package annotations

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
)

// The fixture is shared with the Vitest suite (app/src/lib/services/annotation-golden.spec.ts): it
// records the operations `addAnnotation`/`deleteAnnotation` issue in TypeScript for scripted graph
// states, and this port must issue the same ones in the same order.
type goldenOp struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type goldenCase struct {
	Name          string     `json:"name"`
	Action        string     `json:"action"`
	Fact          Fact       `json:"fact"`
	Annotation    Annotation `json:"annotation"`
	AnnotatedBy   string     `json:"annotatedBy"`
	AnnotatedAt   string     `json:"annotatedAt"`
	AnnotationIRI string     `json:"annotationIri"`
	Answers       []answer   `json:"answers"`
	Mint          struct {
		Statement  string `json:"statement"`
		Annotation string `json:"annotation"`
	} `json:"mint"`
	Expected struct {
		Ops   []goldenOp `json:"ops"`
		IRI   string     `json:"iri"`
		Error string     `json:"error"`
	} `json:"expected"`
}

type answer struct {
	Ask    *bool `json:"ask"`
	Select []map[string]struct {
		Type  string `json:"type"`
		Value string `json:"value"`
	} `json:"select"`
}

// scriptedGraph replays the fixture's answers in the order queries arrive and records every op.
type scriptedGraph struct {
	answers []answer
	ops     []goldenOp
}

func norm(s string) string { return strings.Join(strings.Fields(s), " ") }

func (g *scriptedGraph) next(kind, text string) (answer, error) {
	g.ops = append(g.ops, goldenOp{Kind: kind, Text: norm(text)})
	if len(g.answers) == 0 {
		return answer{}, errors.New("unscripted query: " + norm(text))
	}
	a := g.answers[0]
	g.answers = g.answers[1:]
	return a, nil
}

func (g *scriptedGraph) Ask(_ context.Context, q string) (bool, error) {
	a, err := g.next("ask", q)
	if err != nil {
		return false, err
	}
	if a.Ask == nil {
		return false, errors.New("scripted answer is not an ASK result")
	}
	return *a.Ask, nil
}

func (g *scriptedGraph) Select(_ context.Context, q string) (graphdb.SelectResult, error) {
	var res graphdb.SelectResult
	a, err := g.next("select", q)
	if err != nil {
		return res, err
	}
	for _, row := range a.Select {
		b := map[string]graphdb.Binding{}
		for k, v := range row {
			b[k] = graphdb.Binding{Type: v.Type, Value: v.Value}
		}
		res.Results.Bindings = append(res.Results.Bindings, b)
	}
	return res, nil
}

func (g *scriptedGraph) Update(_ context.Context, u string) error {
	g.ops = append(g.ops, goldenOp{Kind: "update", Text: norm(u)})
	return nil
}

func TestAgreesWithGoldenVectors(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/golden/annotations.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		DefaultNamespaceBaseIRI string       `json:"defaultNamespaceBaseIri"`
		Cases                   []goldenCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Cases) == 0 {
		t.Fatal("no fixtures loaded")
	}
	for _, c := range g.Cases {
		t.Run(c.Name, func(t *testing.T) {
			graph := &scriptedGraph{answers: c.Answers}
			svc := New(graph, g.DefaultNamespaceBaseIRI)
			svc.mintStatement = func(ns string) string { return ns + "#Statement" + c.Mint.Statement }
			svc.mintAnnotation = func(stmt string) string {
				return stmt[:strings.Index(stmt, "#")] + "#Annotation" + c.Mint.Annotation
			}

			var iri string
			var runErr error
			if c.Action == "delete" {
				runErr = svc.Delete(context.Background(), c.AnnotationIRI)
			} else {
				iri, runErr = svc.Add(context.Background(), c.Fact, c.Annotation, c.AnnotatedBy, c.AnnotatedAt)
			}

			gotErr := ""
			if runErr != nil {
				gotErr = runErr.Error()
			}
			if gotErr != c.Expected.Error {
				t.Errorf("error = %q, want %q", gotErr, c.Expected.Error)
			}
			if iri != c.Expected.IRI {
				t.Errorf("iri = %q, want %q", iri, c.Expected.IRI)
			}
			if len(graph.ops) != len(c.Expected.Ops) {
				t.Fatalf("issued %d operations, want %d:\n got: %v\nwant: %v", len(graph.ops), len(c.Expected.Ops), graph.ops, c.Expected.Ops)
			}
			for i, want := range c.Expected.Ops {
				if graph.ops[i] != want {
					t.Errorf("operation %d\n got: %s %s\nwant: %s %s", i, graph.ops[i].Kind, graph.ops[i].Text, want.Kind, want.Text)
				}
			}
			if len(graph.answers) != 0 {
				t.Errorf("%d scripted answers were never consumed", len(graph.answers))
			}
		})
	}
}

func TestErrorClassification(t *testing.T) {
	svc := New(&scriptedGraph{}, "https://example.com/o")
	_, err := svc.Add(context.Background(),
		Fact{SubjectIRI: "https://example.com/o#a", PredicateIRI: "https://example.com/o#p", Object: Object{Kind: "literal", Value: "v"}},
		Annotation{Type: "text", Text: " "}, "alice", "2026-01-01T00:00:00.000Z")
	if !IsInputError(err) {
		t.Errorf("empty text: IsInputError(%v) = false, want true", err)
	}

	// An unscripted graph fails every query: that is a graph failure, not bad input.
	_, err = svc.Add(context.Background(),
		Fact{SubjectIRI: "https://example.com/o#a", PredicateIRI: "https://example.com/o#p", Object: Object{Kind: "literal", Value: "v"}},
		Annotation{Type: "text", Text: "x"}, "alice", "2026-01-01T00:00:00.000Z")
	if err == nil || IsInputError(err) {
		t.Errorf("graph failure: err = %v, IsInputError = %v, want a non-input error", err, IsInputError(err))
	}
}

func TestDefaultMintersProduceTheTSShapes(t *testing.T) {
	svc := New(&scriptedGraph{}, "https://example.com/o")
	stmt := svc.mintStatement("https://example.com/ns")
	if !regexpMatch(`^https://example\.com/ns#Statement\d{17}[0-9a-z]+$`, stmt) {
		t.Errorf("statement IRI = %q", stmt)
	}
	ann := svc.mintAnnotation(stmt)
	if !regexpMatch(`^https://example\.com/ns#Annotation[0-9a-z]{14,}$`, ann) {
		t.Errorf("annotation IRI = %q", ann)
	}
	if ann == svc.mintAnnotation(stmt) {
		t.Error("annotation IRIs must be unique per call")
	}
}
