package sparqlsafe

import (
	"encoding/json"
	"os"
	"testing"
)

// The fixtures are shared with the Vitest suite (app/src/lib/utils/sparql-safe.spec.ts): they are
// what keeps this package and the TypeScript guards in agreement.
type golden struct {
	SafeIRI []struct {
		Name  string `json:"name"`
		Input string `json:"input"`
		Safe  bool   `json:"safe"`
	} `json:"safeIri"`
	EscapeString []struct {
		Name   string `json:"name"`
		Input  string `json:"input"`
		Output string `json:"output"`
	} `json:"escapeString"`
	NamespaceGraphs []struct {
		Name    string `json:"name"`
		BaseIRI string `json:"baseIri"`
		Graphs  Graphs `json:"graphs"`
	} `json:"namespaceGraphs"`
	DefaultNamespaceBaseIRI []struct {
		Name    string `json:"name"`
		Raw     string `json:"raw"`
		BaseIRI string `json:"baseIri"`
	} `json:"defaultNamespaceBaseIri"`
}

func loadGolden(t *testing.T) golden {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/golden/sparql-safe.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestSafeIRI(t *testing.T) {
	for _, c := range loadGolden(t).SafeIRI {
		t.Run(c.Name, func(t *testing.T) {
			if got := SafeIRI(c.Input); got != c.Safe {
				t.Errorf("SafeIRI(%q) = %v, want %v", c.Input, got, c.Safe)
			}
			err := AssertSafeIRI(c.Input, "IRI")
			if c.Safe && err != nil {
				t.Errorf("AssertSafeIRI(%q) = %v, want nil", c.Input, err)
			}
			if !c.Safe && err == nil {
				t.Errorf("AssertSafeIRI(%q) = nil, want error", c.Input)
			}
		})
	}
}

func TestAssertSafeIRIMessage(t *testing.T) {
	err := AssertSafeIRI("a b", "graph")
	want := "Invalid graph: contains characters not allowed in a SPARQL IRI"
	if err == nil || err.Error() != want {
		t.Errorf("got %v, want %q", err, want)
	}
}

func TestEscapeString(t *testing.T) {
	for _, c := range loadGolden(t).EscapeString {
		t.Run(c.Name, func(t *testing.T) {
			if got := EscapeString(c.Input); got != c.Output {
				t.Errorf("EscapeString(%q) = %q, want %q", c.Input, got, c.Output)
			}
		})
	}
}

func TestNamespaceGraphs(t *testing.T) {
	for _, c := range loadGolden(t).NamespaceGraphs {
		t.Run(c.Name, func(t *testing.T) {
			if got := NamespaceGraphs(c.BaseIRI); got != c.Graphs {
				t.Errorf("NamespaceGraphs(%q) = %+v, want %+v", c.BaseIRI, got, c.Graphs)
			}
		})
	}
}

func TestDefaultNamespaceBaseIRI(t *testing.T) {
	for _, c := range loadGolden(t).DefaultNamespaceBaseIRI {
		t.Run(c.Name, func(t *testing.T) {
			if got := DefaultNamespaceBaseIRI(c.Raw); got != c.BaseIRI {
				t.Errorf("DefaultNamespaceBaseIRI(%q) = %q, want %q", c.Raw, got, c.BaseIRI)
			}
		})
	}
}

func TestUTF16Len(t *testing.T) {
	cases := map[string]int{"": 0, "abc": 3, "é": 1, "✓": 1, "😀": 2, "a😀b": 4}
	for in, want := range cases {
		if got := UTF16Len(in); got != want {
			t.Errorf("UTF16Len(%q) = %d, want %d", in, got, want)
		}
	}
}
