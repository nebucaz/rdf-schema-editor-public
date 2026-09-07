package sync

// RDF/RDFS/OWL/PROV/XSD IRIs the merge writer needs — written as literal, fully-qualified `<IRI>`
// terms throughout this package (no `PREFIX` declarations), so these are the sole source of truth
// for those terms on the Go side, mirroring `turtle.ts`'s `DCAT`/`DCT`/`PROV` constants' role on the
// TS side.
const (
	rdfType           = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
	rdfsLabel         = "http://www.w3.org/2000/01/rdf-schema#label"
	rdfsSubClassOf    = "http://www.w3.org/2000/01/rdf-schema#subClassOf"
	owlClass          = "http://www.w3.org/2002/07/owl#Class"
	owlObjectProperty = "http://www.w3.org/2002/07/owl#ObjectProperty"
	xsdDateTime       = "http://www.w3.org/2001/XMLSchema#dateTime"

	provActivity       = "http://www.w3.org/ns/prov#Activity"
	provWasGeneratedBy = "http://www.w3.org/ns/prov#wasGeneratedBy"
	provStartedAtTime  = "http://www.w3.org/ns/prov#startedAtTime"
	provEndedAtTime    = "http://www.w3.org/ns/prov#endedAtTime"

	// shTargetClass/shProperty/shPath/shMaxCount/shClass (STORY-101/105) are the SHACL terms
	// `fetchPropertyShapeConstraint`'s shared shape-reading query reads — the Go-side mirror of
	// `sparql-connector.ts`'s own `sh:targetClass`/`sh:property`/`sh:path`/`sh:maxCount`/`sh:class`
	// lookups (e.g. `fetchGenericPropertyShapeDetails`). shClass is STORY-105's own addition, read to
	// validate a `represents` annotation's target IRI against the predicate's required range.
	shTargetClass = "http://www.w3.org/ns/shacl#targetClass"
	shProperty    = "http://www.w3.org/ns/shacl#property"
	shPath        = "http://www.w3.org/ns/shacl#path"
	shMaxCount    = "http://www.w3.org/ns/shacl#maxCount"
	shClass       = "http://www.w3.org/ns/shacl#class"
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
	// NamespacePredicateIRI is `config.Config.NamespacePredicateIRI()` (STORY-099) — `rse:namespace`,
	// declared on a shadow concept class (own or inherited from `backstage:CoreConcept`), resolved
	// per mapped `kind` by `Engine.resolveConceptNamespace` to pick each synced individual's target
	// Namespace, replacing the old single fixed per-source namespace.
	NamespacePredicateIRI string
	// SourceFieldPredicateIRI is `config.Config.SourceFieldPredicateIRI()` (STORY-101) —
	// `rse:sourceField`, declared on an already-existing `owl:DatatypeProperty`, resolved per mapped
	// `kind` by `Engine.resolveSourceFieldMapping` to decide which ingestion-source field values
	// actually land on a synced individual (source-agnostic — Backstage is the first ingestor, not
	// the only one this predicate is meant for).
	SourceFieldPredicateIRI string
	// AppSettingsIRI/RepresentsPredicateSettingIRI (STORY-103) are `config.Config`'s own methods of
	// the same name — the well-known settings subject and the `rse:representsPredicate` setting
	// predicate `FetchRepresentsPredicateIri` reads once per run to resolve which `owl:ObjectProperty`
	// STORY-105's `represents` triples are written with.
	AppSettingsIRI                string
	RepresentsPredicateSettingIRI string
	// SourceRelationPredicateIRI is `config.Config.SourceRelationPredicateIRI()` (STORY-106) —
	// `rse:sourceRelation`, declared on an already-existing `owl:ObjectProperty`, resolved per mapped
	// `kind` by `Engine.resolveSourceRelationMapping` to decide which upstream relation types mirror
	// onto edges between synced shadow individuals.
	SourceRelationPredicateIRI string
	// SyncSourceRefPredicateIRI is `config.Config.SyncSourceRefPredicateIRI()` (STORY-106) — the
	// generator-owned `rse:syncSourceRef` marker `mergeWriteOps` writes on every synced individual,
	// and `Engine.resolveSyncSourceRefTarget` reads back to resolve a relation's `targetRef` to the
	// local individual IRI it was minted for.
	SyncSourceRefPredicateIRI string
}
