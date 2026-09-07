package sync

import (
	"fmt"
	"sort"
)

// deleteWhereOp builds `DELETE WHERE { GRAPH <graph> { <subject> <predicate> ?o } }` — the
// generator-owned-predicate merge shape `generateCatalogForClass` (data-catalog Story 012) uses on
// the TS side: harmless (deletes nothing) if the predicate isn't currently set, so callers never
// need an existence check first.
func deleteWhereOp(graph, subject, predicate string) string {
	return fmt.Sprintf(`DELETE WHERE { GRAPH <%s> { <%s> <%s> ?o } }`, graph, subject, predicate)
}

// insertDataOp builds `INSERT DATA { GRAPH <graph> { <triples> } }` — triples must already be valid
// SPARQL triple syntax (caller-built `<s> <p> <o> .` sequences).
func insertDataOp(graph, triples string) string {
	return fmt.Sprintf(`INSERT DATA { GRAPH <%s> { %s } }`, graph, triples)
}

// askTripleExistsIRI/askTripleExistsLiteral build `ASK { GRAPH <graph> { <s> <p> <o> } }` for an IRI
// or a plain string-literal object respectively — the two shapes every idempotent bootstrap check in
// this package needs (namespace/class/individual existence, an existing isMasterFor assertion).
func askTripleExistsIRI(graph, subject, predicate, object string) string {
	return fmt.Sprintf(`ASK { GRAPH <%s> { <%s> <%s> <%s> } }`, graph, subject, predicate, object)
}

func askTripleExistsLiteral(graph, subject, predicate, literal string) string {
	return fmt.Sprintf(`ASK { GRAPH <%s> { <%s> <%s> "%s" } }`, graph, subject, predicate, escapeString(literal))
}

// askCrossGraphTripleExistsIRI builds `ASK { GRAPH ?g { <s> <p> <o> } }` — an unrestricted-graph ASK
// (STORY-105), used by `Engine.resolveRepresentsTarget` to check a `represents` annotation target's
// `rdf:type` without knowing in advance which namespace/graph that individual lives in, unlike
// `askTripleExistsIRI`'s fixed-graph shape (every other bootstrap/existence check in this package
// already knows its own target graph).
func askCrossGraphTripleExistsIRI(subject, predicate, object string) string {
	return fmt.Sprintf(`ASK { GRAPH ?g { <%s> <%s> <%s> } }`, subject, predicate, object)
}

// mergeWriteOps computes the `DELETE`/`INSERT` op sequence for one seen-this-run synced individual
// (Story 007): the generator-owned predicate set — `rdf:type`, `rdfs:label`, the sync-source marker
// (Story 010), the sync-source-ref marker (STORY-106), `prov:wasGeneratedBy` — is fully replaced;
// `syncStatus` (Story 009) is always cleared here, since a seen-this-run individual can never be
// stale. Anything a human added outside this predicate set on the same subject is never touched,
// since only these specific predicates are ever named in a DELETE WHERE.
//
// sourceRef (STORY-106) is the entity's own upstream target-reference identity (Backstage:
// `kind:namespace/name`, `Entity.SourceRef`) — written as `rse:syncSourceRef`, the join key
// `Engine.resolveSyncSourceRefTarget`/the in-run `sourceRefToIndividualIRI` map resolve a *different*
// entity's relation `targetRef` against. An empty sourceRef still clears any stale marker from a
// prior run (same DELETE-always posture as every other predicate here) but writes no new triple.
func mergeWriteOps(vocab Vocabulary, graph, individual, classIRI, label, sourceName, sourceRef, activity string) []string {
	ops := []string{
		deleteWhereOp(graph, individual, rdfType),
		deleteWhereOp(graph, individual, rdfsLabel),
		deleteWhereOp(graph, individual, vocab.SyncSourcePredicateIRI),
		deleteWhereOp(graph, individual, vocab.SyncSourceRefPredicateIRI),
		deleteWhereOp(graph, individual, vocab.SyncStatusPredicateIRI),
		deleteWhereOp(graph, individual, provWasGeneratedBy),
		insertDataOp(graph, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "%s" . <%s> <%s> "%s" . <%s> <%s> <%s> .`,
			individual, rdfType, classIRI,
			individual, rdfsLabel, escapeString(label),
			individual, vocab.SyncSourcePredicateIRI, escapeString(sourceName),
			individual, provWasGeneratedBy, activity,
		)),
	}
	if sourceRef != "" {
		ops = append(ops, insertDataOp(graph, fmt.Sprintf(
			`<%s> <%s> "%s" .`, individual, vocab.SyncSourceRefPredicateIRI, escapeString(sourceRef),
		)))
	}
	return ops
}

// mappedAttributeOps computes the DELETE WHERE + INSERT op sequence for one synced individual's
// `rse:sourceField`-mapped datatype properties (STORY-101), keyed by property IRI in mapping
// (Engine.resolveSourceFieldMapping's return value). Each mapped predicate is generator-owned and
// fully replaced every run — a DELETE WHERE is always issued, even when nothing is written this
// run, so a value present in a prior run and absent (or empty) this one is cleared, matching
// mergeWriteOps' own fixed-predicate-set semantics. A resolved array value (entity.FieldLists)
// against a non-repeatable property is a mapping-config error: the DELETE still runs (the
// predicate is cleared, same as an absent field) but nothing is inserted, and the failure is
// appended to failures for the caller to fold into SyncSummary — never an error that aborts the
// entity's sync.
func mappedAttributeOps(graph, individual string, mapping map[string]SourceFieldMapping, entity Entity) (ops []string, failures []string) {
	props := make([]string, 0, len(mapping))
	for propIRI := range mapping {
		props = append(props, propIRI)
	}
	sort.Strings(props) // deterministic op order — map iteration order is randomized

	for _, propIRI := range props {
		m := mapping[propIRI]
		ops = append(ops, deleteWhereOp(graph, individual, propIRI))

		if values, ok := entity.FieldLists[m.Path]; ok {
			if !m.Repeatable {
				failures = append(failures, fmt.Sprintf(
					"%s: sourceField %q resolved to an array but <%s> is not repeatable (sh:maxCount 1) — skipped",
					entity.UID, m.Path, propIRI,
				))
				continue
			}
			for _, v := range values {
				if v == "" {
					continue
				}
				ops = append(ops, insertDataOp(graph, fmt.Sprintf(`<%s> <%s> "%s" .`, individual, propIRI, escapeString(v))))
			}
			continue
		}

		if value, ok := entity.Fields[m.Path]; ok && value != "" {
			ops = append(ops, insertDataOp(graph, fmt.Sprintf(`<%s> <%s> "%s" .`, individual, propIRI, escapeString(value))))
		}
	}
	return ops, failures
}

// representsOps computes the DELETE WHERE + (conditional) INSERT op sequence for one synced
// individual's `represents` link (STORY-105) — the predicate is always DELETE WHERE'd first
// (generator-owned, fully replaced every run, same posture as every other predicate
// `mergeWriteOps`/`mappedAttributeOps` own), so a link written in a prior run and no longer valid
// this run (annotation removed, or now resolving to something invalid) is correctly cleared. The
// INSERT is only appended when targetIRI is non-empty — a successfully resolved link this run.
func representsOps(graph, individual, representsPredicateIRI, targetIRI string) []string {
	ops := []string{deleteWhereOp(graph, individual, representsPredicateIRI)}
	if targetIRI != "" {
		ops = append(ops, insertDataOp(graph, fmt.Sprintf(`<%s> <%s> <%s> .`, individual, representsPredicateIRI, targetIRI)))
	}
	return ops
}

// staleOps computes the op sequence for a previously-synced individual absent from this run's fetch
// (Story 009) — touches only `syncStatus`, leaving every other predicate (including its previous
// `prov:wasGeneratedBy`) exactly as the last run that actually saw it left them, per the story's "all
// its other data untouched" requirement.
func staleOps(vocab Vocabulary, graph, individual string) []string {
	return []string{
		deleteWhereOp(graph, individual, vocab.SyncStatusPredicateIRI),
		insertDataOp(graph, fmt.Sprintf(`<%s> <%s> "%s" .`, individual, vocab.SyncStatusPredicateIRI, syncStaleValue)),
	}
}

// activityTripleOps declares the shared `prov:Activity` individual every seen-this-run merge write
// this call references via `prov:wasGeneratedBy` — written once per run, not once per individual.
func activityTripleOps(graph, activity, nowISO string) []string {
	return []string{
		insertDataOp(graph, fmt.Sprintf(
			`<%s> <%s> <%s> . <%s> <%s> "%s"^^<%s> . <%s> <%s> "%s"^^<%s> .`,
			activity, rdfType, provActivity,
			activity, provStartedAtTime, nowISO, xsdDateTime,
			activity, provEndedAtTime, nowISO, xsdDateTime,
		)),
	}
}
