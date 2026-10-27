package shortlinks

import (
	"encoding/json"
	"os"
	"testing"
)

// The fixtures are shared with the Vitest suite (app/src/lib/services/query-model-golden.spec.ts).
func loadGolden(t *testing.T) (g struct {
	MaxSharedModelBytes int `json:"maxSharedModelBytes"`
	IsShortID           []struct {
		Input string `json:"input"`
		Valid bool   `json:"valid"`
	} `json:"isShortId"`
	NewShortID []struct {
		Name    string   `json:"name"`
		Batches [][]byte `json:"batches"`
		ID      string   `json:"id"`
	} `json:"newShortId"`
}) {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/golden/query-model.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

func TestMaxSharedModelBytes(t *testing.T) {
	if want := loadGolden(t).MaxSharedModelBytes; MaxSharedModelBytes != want {
		t.Errorf("MaxSharedModelBytes = %d, want %d", MaxSharedModelBytes, want)
	}
}

func TestIsShortID(t *testing.T) {
	for _, c := range loadGolden(t).IsShortID {
		if got := IsShortID(c.Input); got != c.Valid {
			t.Errorf("IsShortID(%q) = %v, want %v", c.Input, got, c.Valid)
		}
	}
}

func TestNewShortIDFrom(t *testing.T) {
	for _, c := range loadGolden(t).NewShortID {
		t.Run(c.Name, func(t *testing.T) {
			i := 0
			got := newShortID(func(n int) []byte { b := c.Batches[i]; i++; return b })
			if got != c.ID {
				t.Errorf("id = %q, want %q", got, c.ID)
			}
		})
	}
}

func TestNewShortID(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		id := NewShortID()
		if !IsShortID(id) {
			t.Fatalf("NewShortID() = %q, not a short id", id)
		}
		seen[id] = true
	}
	if len(seen) < 50 {
		t.Errorf("NewShortID repeated itself: %d distinct of 50", len(seen))
	}
}

func TestExceedsMaxSharedModelBytes(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"empty", "", false},
		{"at the cap", string(make([]byte, MaxSharedModelBytes)), false},
		{"over the cap", string(make([]byte, MaxSharedModelBytes+1)), true},
		// TS counts UTF-16 code units: an astral character is 2, though 4 bytes in UTF-8.
		{"astral counts as two units", repeat("😀", MaxSharedModelBytes/2+1), true},
		{"astral at the cap", repeat("😀", MaxSharedModelBytes/2), false},
		// ...and a BMP character is 1 unit, though up to 3 bytes.
		{"BMP counts as one unit", repeat("é", MaxSharedModelBytes), false},
	}
	for _, c := range cases {
		if got := ExceedsMaxSharedModelBytes(c.in); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func repeat(s string, n int) string {
	b := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		b = append(b, s...)
	}
	return string(b)
}

func TestSharedQueryIRI(t *testing.T) {
	got := SharedQueryIRI("aZ09aZ09aZ", "http://example.org/ns/")
	want := "http://example.org/ns/schema#SharedQueryaZ09aZ09aZ"
	if got != want {
		t.Errorf("SharedQueryIRI = %q, want %q", got, want)
	}
}
