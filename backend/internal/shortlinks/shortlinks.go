// Package shortlinks holds the short share-link id rules shared with the browser. It mirrors
// `app/src/lib/services/short-links.ts` and `sharedQueryIri` in `app/src/lib/utils/iri.ts`;
// `backend/testdata/golden/query-model.json` is the agreement mechanism.
package shortlinks

import (
	"crypto/rand"
	"strings"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/sparqlsafe"
)

const (
	alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	// ShortIDLength is the number of base62 characters in a short id.
	ShortIDLength = 10
	// MaxSharedModelBytes is the upper bound for a stored model's JSON, measured like the browser's
	// `string.length` (UTF-16 code units).
	MaxSharedModelBytes = 200_000
)

// IsShortID reports whether id is exactly 10 ASCII alphanumerics.
func IsShortID(id string) bool {
	if len(id) != ShortIDLength {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

// NewShortID returns 10 base62 characters (~59 bits) from crypto/rand.
func NewShortID() string {
	return newShortID(func(n int) []byte {
		b := make([]byte, n)
		if _, err := rand.Read(b); err != nil {
			panic("shortlinks: crypto/rand failed: " + err.Error())
		}
		return b
	})
}

// newShortID maps random bytes onto the alphabet; rejection sampling (bytes >= 248 are skipped)
// avoids modulo bias.
func newShortID(random func(n int) []byte) string {
	var id strings.Builder
	for id.Len() < ShortIDLength {
		for _, b := range random(ShortIDLength * 2) {
			if b < 248 && id.Len() < ShortIDLength {
				id.WriteByte(alphabet[int(b)%len(alphabet)])
			}
		}
	}
	return id.String()
}

// ExceedsMaxSharedModelBytes reports whether raw is longer than MaxSharedModelBytes UTF-16 code units.
func ExceedsMaxSharedModelBytes(raw string) bool {
	return len(raw) > MaxSharedModelBytes && sparqlsafe.UTF16Len(raw) > MaxSharedModelBytes
}

// SharedQueryIRI is the node IRI for a short-link id; the caller must have validated id.
func SharedQueryIRI(id, namespaceBaseIRI string) string {
	return sparqlsafe.NamespaceGraphs(namespaceBaseIRI).Schema + "#SharedQuery" + id
}
