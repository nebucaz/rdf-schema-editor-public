package sync

import (
	"fmt"
	"strings"
)

// namespaceGraphs mirrors `app/src/lib/config.ts`'s `namespaceGraphs()`: a namespace's two storage
// graphs this package writes to, derived from its base IRI alone (path-segment suffixes, not
// fragment suffixes, matching the TS side exactly so a Go-written graph and a TS-read graph agree).
type namespaceGraphs struct {
	instances string
	schema    string
}

func deriveNamespaceGraphs(baseIRI string) namespaceGraphs {
	base := strings.TrimSuffix(baseIRI, "/")
	return namespaceGraphs{instances: base, schema: base + "/schema"}
}

// unsafeSparqlIRIChars mirrors `sparql-connector.ts`'s `UNSAFE_SPARQL_IRI_CHARS` — characters
// excluded from the SPARQL 1.1 IRIREF grammar production.
func isUnsafeSparqlIRIByte(b byte) bool {
	switch b {
	case '<', '>', '"', '{', '}', '|', '^', '`', '\\':
		return true
	}
	return b <= 0x20
}

// sanitizeLocalNameSegment percent-encodes any byte outside the IRI-unreserved set, so an external,
// untrusted `metadata.uid`/entity value can never inject a SPARQL-unsafe character (or a raw `#`
// that would silently change the local name's own fragment boundary) into a minted IRI — a stricter,
// always-succeeding sibling of `sparql-connector.ts`'s `assertSafeSparqlIri` (which rejects instead
// of sanitizing; rejecting an entire sync run over one upstream entity's odd UID would be too
// destructive here, so this sanitizes instead).
func sanitizeLocalNameSegment(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '.' || c == '_' || c == '~' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// isSafeSparqlIRI mirrors `sparql-connector.ts`'s `isSafeSparqlIri` — guards an externally-sourced
// IRI (STORY-105's `represents` annotation value, read verbatim off a Backstage entity) before
// interpolating it as an `<IRI>` term into a SPARQL query, unlike `sanitizeLocalNameSegment`'s
// always-succeeding local-name-segment sanitization above: rejecting a malformed/hostile annotation
// value outright is correct here, since it's used as a whole IRI term, not folded into one this
// package itself mints.
func isSafeSparqlIRI(iri string) bool {
	if iri == "" {
		return false
	}
	for i := 0; i < len(iri); i++ {
		if isUnsafeSparqlIRIByte(iri[i]) {
			return false
		}
	}
	return true
}

// escapeString mirrors `sparql-connector.ts`'s private `escapeString` — escapes `"`/`\` so a literal
// can be safely embedded in a double-quoted SPARQL string term.
func escapeString(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '"' || c == '\\' {
			b.WriteByte('\\')
		}
		b.WriteByte(c)
	}
	return b.String()
}

// sourceNamespaceBaseIRI is the namespace a source's own bootstrap infrastructure lives under — its
// `SystemOfWork` class/individual, its `isMasterFor` predicate if freshly minted, and the per-run
// `prov:Activity` individual (STORY-099: no longer where synced *individuals* of a mapped shadow
// class land — see `Engine.resolveConceptNamespace` for that) — `<defaultNamespaceBaseIRI>/
// <sourceName>`, e.g. `.../backstage` — a sibling of the app's default namespace, never nested inside
// it, so a second source gets its own namespace for free by simply registering under a different
// Name().
func sourceNamespaceBaseIRI(defaultNamespaceBaseIRI, sourceName string) string {
	return defaultNamespaceBaseIRI + "/" + sourceName
}

// individualIRI mints a synced individual's IRI deterministically from its source's stable `uid`
// (Story 007) — `<sourceNamespaceBaseIRI>#<sourceName>-<uid>`, under the source's own namespace,
// mirroring `iri.ts`'s `<base>#LocalName` shape. Re-running the sync against the same `uid` always
// recomputes the identical IRI, so nothing is ever duplicate-minted.
func individualIRI(sourceNS namespaceGraphs, sourceName, uid string) string {
	return fmt.Sprintf("%s#%s-%s", sourceNS.instances, sourceName, sanitizeLocalNameSegment(uid))
}

// systemOfWorkClassIRI/systemOfWorkIndividualIRI are the source's own well-known `SystemOfWork`
// class + singleton individual (Story 007's bootstrap) — minted deterministically under the
// source's own namespace so the ASK-exists-guard in `Engine.ensureSystemOfWork` is a plain IRI
// lookup, no search needed.
func systemOfWorkClassIRI(sourceNS namespaceGraphs) string {
	return sourceNS.schema + "#SystemOfWork"
}

func systemOfWorkIndividualIRI(sourceNS namespaceGraphs, sourceName string) string {
	return fmt.Sprintf("%s#%s", sourceNS.instances, capitalize(sourceName))
}

// genericIsMasterForPredicateIRI is the deterministic fallback IRI minted under the source's own
// namespace when no existing `owl:ObjectProperty` anywhere is already labeled "isMasterFor"
// (`Engine.resolveIsMasterForPredicate`) — mirrors `genericPropertyIri`'s `<base>#camelCase(name)`
// shape.
func genericIsMasterForPredicateIRI(sourceNS namespaceGraphs) string {
	return sourceNS.schema + "#isMasterFor"
}

// activityIRI mints a fresh, never-reused `prov:Activity` IRI for one sync run (Story 007) — unlike
// the deterministic IRIs above, intentionally unique per call so concurrent/successive runs never
// collide, mirroring `publicationActivityIri`'s `timestamp`-uniqueness pattern.
func activityIRI(sourceNS namespaceGraphs, sourceName string, uniqueToken string) string {
	return fmt.Sprintf("%s#%sSyncActivity%s", sourceNS.instances, capitalize(sourceName), uniqueToken)
}

// lastPathSegment returns baseIRI's final `/`-separated path segment (trailing slash ignored) — used
// as the deterministic `prefix` value when the engine bootstraps a per-Concept Namespace declaration
// it has never seen before (STORY-099), mirroring how the old fixed per-source namespace's own prefix
// was simply `source.Name()`, its own final path segment.
func lastPathSegment(baseIRI string) string {
	trimmed := strings.TrimSuffix(baseIRI, "/")
	idx := strings.LastIndexByte(trimmed, '/')
	if idx < 0 {
		return trimmed
	}
	return trimmed[idx+1:]
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
