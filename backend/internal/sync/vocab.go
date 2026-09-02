package sync

// RDF/RDFS/OWL/PROV/XSD IRIs the merge writer needs — written as literal, fully-qualified `<IRI>`
// terms throughout this package (no `PREFIX` declarations), so these are the sole source of truth
// for those terms on the Go side, mirroring `turtle.ts`'s `DCAT`/`DCT`/`PROV` constants' role on the
// TS side.
const (
	rdfType           = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
	rdfsLabel         = "http://www.w3.org/2000/01/rdf-schema#label"
	owlClass          = "http://www.w3.org/2002/07/owl#Class"
	owlObjectProperty = "http://www.w3.org/2002/07/owl#ObjectProperty"
	xsdDateTime       = "http://www.w3.org/2001/XMLSchema#dateTime"

	provActivity       = "http://www.w3.org/ns/prov#Activity"
	provWasGeneratedBy = "http://www.w3.org/ns/prov#wasGeneratedBy"
	provStartedAtTime  = "http://www.w3.org/ns/prov#startedAtTime"
	provEndedAtTime    = "http://www.w3.org/ns/prov#endedAtTime"
)

// isMasterForLabel is the `rdfs:label` convention `fetchMasterSystemsOfClass`/`resolveOrMintPredicate`
// key off on the TS side (`sparql-connector.ts`) — any `owl:ObjectProperty` with this exact label, in
// any namespace, is honored as an `isMasterFor` assertion. Not a fixed IRI, since a human may already
// have declared one in any namespace; the engine reuses it if found, mints a fresh generic one under
// the syncing source's own namespace otherwise (see `Engine.resolveIsMasterForPredicate`).
const isMasterForLabel = "isMasterFor"

// syncStaleValue is the literal `rse:syncStatus` object value for a soft-flagged stale individual
// (Story 009). No other value is ever written by this package — the predicate is simply absent for
// a normal, currently-seen synced individual.
const syncStaleValue = "stale"

// Vocabulary bundles every predicate/namespace IRI Engine needs, computed once from config.Config
// (see `config.Config`'s own `SyncSourcePredicateIRI`/etc. methods) and passed in at construction —
// keeps this package free of a direct `config` import, matching how `FetchKindMapping` already takes
// its predicate IRI as a plain parameter rather than reading config itself.
type Vocabulary struct {
	// DefaultNamespaceBaseIRI is the app's own default namespace's base IRI (config.Config's
	// DefaultNamespaceBaseIRI()) — every ingestion source's own namespace mints as
	// `<DefaultNamespaceBaseIRI>/<source.Name()>`, and every Namespace *declaration* triple
	// (regardless of which namespace it declares) is written into this default namespace's own
	// `/schema` graph, mirroring `insertNamespace`'s convention exactly.
	DefaultNamespaceBaseIRI string
	// BackstageKindPredicateIRI is `config.Config.BackstageKindPredicateIRI()` — stays
	// Backstage-specific (Story 003's deliberate non-generalization), passed straight through to
	// `FetchKindMapping`.
	BackstageKindPredicateIRI string
	// SyncSourcePredicateIRI/SyncStatusPredicateIRI are `config.Config`'s own methods of the same
	// name — must match the frontend's `iri.ts` constants of the same name exactly, since both
	// sides derive them from the same shared `PUBLIC_SCHEMA_NAMESPACE` value.
	SyncSourcePredicateIRI string
	SyncStatusPredicateIRI string
	NamespaceClassIRI      string
	NamespacePrefixIRI     string
}
