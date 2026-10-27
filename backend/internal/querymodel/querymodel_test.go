package querymodel

import (
	"encoding/json"
	"os"
	"testing"
)

// The fixtures are shared with the Vitest suite (app/src/lib/services/query-model-golden.spec.ts):
// they are what keeps this parser and `parseQueryModel` in agreement.
type goldenCase struct {
	Name      string `json:"name"`
	Text      string `json:"text"`
	OK        bool   `json:"ok"`
	Canonical string `json:"canonical"`
	Error     string `json:"error"`
}

func TestParseAgreesWithGoldenVectors(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/golden/query-model.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		QueryModels []goldenCase `json:"queryModels"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.QueryModels) == 0 {
		t.Fatal("no fixtures loaded")
	}
	for _, c := range g.QueryModels {
		t.Run(c.Name, func(t *testing.T) {
			got, err := Parse(c.Text)
			if c.OK {
				if err != nil {
					t.Fatalf("Parse returned error %q, want success", err)
				}
				if got != c.Canonical {
					t.Errorf("canonical JSON\n got: %s\nwant: %s", got, c.Canonical)
				}
				return
			}
			if err == nil {
				t.Fatalf("Parse succeeded (%s), want error %q", got, c.Error)
			}
			if err.Error() != c.Error {
				t.Errorf("error = %q, want %q", err.Error(), c.Error)
			}
		})
	}
}
