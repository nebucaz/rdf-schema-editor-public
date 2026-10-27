// Package sparqlsafe holds the SPARQL interpolation guards and namespace/graph derivation that the
// Go handlers share. It mirrors `app/src/lib/utils/sparql-safe.ts` and `app/src/lib/config.ts`;
// `backend/testdata/golden/sparql-safe.json` is the agreement mechanism, loaded by both this
// package's tests and the Vitest suite.
package sparqlsafe

import (
	"fmt"
	"strings"
)

// isUnsafeIRIByte reports bytes excluded from the SPARQL 1.1 IRIREF production. Bytes >= 0x80 are
// parts of multi-byte UTF-8 sequences and are allowed, as in the TS regex.
func isUnsafeIRIByte(b byte) bool {
	switch b {
	case '<', '>', '"', '{', '}', '|', '^', '`', '\\':
		return true
	}
	return b <= 0x20
}

// SafeIRI reports whether value is a safe IRIREF body (the empty string is, as in TS).
func SafeIRI(value string) bool {
	for i := 0; i < len(value); i++ {
		if isUnsafeIRIByte(value[i]) {
			return false
		}
	}
	return true
}

// AssertSafeIRI returns an error for any value that is not a safe IRIREF body.
func AssertSafeIRI(value, fieldName string) error {
	if !SafeIRI(value) {
		return fmt.Errorf("Invalid %s: contains characters not allowed in a SPARQL IRI", fieldName)
	}
	return nil
}

var stringEscaper = strings.NewReplacer(
	`\`, `\\`,
	`"`, `\"`,
	"\n", `\n`,
	"\r", `\r`,
)

// EscapeString escapes a value for use between double quotes in a SPARQL string literal (ECHAR).
func EscapeString(s string) string {
	return stringEscaper.Replace(s)
}

// Graphs is a namespace's four storage graphs.
type Graphs struct {
	Instances string `json:"instances"`
	Schema    string `json:"schema"`
	Shapes    string `json:"shapes"`
	Catalog   string `json:"catalog"`
}

// NamespaceGraphs derives a namespace's graphs from its base IRI alone, normalising a trailing slash.
func NamespaceGraphs(baseIRI string) Graphs {
	base := strings.TrimSuffix(baseIRI, "/")
	return Graphs{
		Instances: base,
		Schema:    base + "/schema",
		Shapes:    base + "/shapes",
		Catalog:   base + "/catalog",
	}
}

// DefaultNamespaceBaseIRI derives the default namespace's base IRI from the raw
// PUBLIC_SCHEMA_NAMESPACE value: drops a trailing `#`, then a trailing `/schema`.
func DefaultNamespaceBaseIRI(raw string) string {
	return strings.TrimSuffix(strings.TrimSuffix(raw, "#"), "/schema")
}

// Prefixes is the PREFIX block every generated query starts with; `PREFIXES` in sparql-connector.ts,
// verbatim.
const Prefixes = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX sh: <http://www.w3.org/ns/shacl#>
`

// UTF16Len is the length JavaScript's `string.length` reports: UTF-16 code units, so an astral
// character counts as two.
func UTF16Len(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}
