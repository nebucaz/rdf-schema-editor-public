package sync

import "fmt"

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

// mergeWriteOps computes the `DELETE`/`INSERT` op sequence for one seen-this-run synced individual
// (Story 007): the generator-owned predicate set — `rdf:type`, `rdfs:label`, the sync-source marker
// (Story 010), `prov:wasGeneratedBy` — is fully replaced; `syncStatus` (Story 009) is always cleared
// here, since a seen-this-run individual can never be stale. Anything a human added outside this
// predicate set on the same subject is never touched, since only these specific predicates are ever
// named in a DELETE WHERE.
func mergeWriteOps(vocab Vocabulary, graph, individual, classIRI, label, sourceName, activity string) []string {
	return []string{
		deleteWhereOp(graph, individual, rdfType),
		deleteWhereOp(graph, individual, rdfsLabel),
		deleteWhereOp(graph, individual, vocab.SyncSourcePredicateIRI),
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
