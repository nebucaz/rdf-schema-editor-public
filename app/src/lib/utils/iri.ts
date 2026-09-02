/**
 * IRI generation utilities for the schema/shapes graph this app maintains, mirroring
 * `semantic-crm`'s `lib/utils/iri.ts` approach but using this project's own namespace
 * (independent app, own GraphDB repository — see `spec/setup/plan.md`'s ADR table).
 */

export { SCHEMA_NAMESPACE, SHAPES_NAMESPACE } from '$lib/config';
import { DEFAULT_NAMESPACE_BASE_IRI, SCHEMA_NAMESPACE, namespaceGraphs } from '$lib/config';

const DEFAULT_GRAPHS = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI);

/**
 * Fallback namespace base IRIs (no trailing `#`) `classIri`/`propertyIri`/`nodeShapeIri`/
 * `individualIri` mint under when a caller doesn't pass an explicit one — the default namespace's
 * `/schema` and `/shapes` graphs (STORY-025). A future caller threading a specific namespace
 * through (STORY-026) passes its base IRI explicitly instead of relying on these.
 */
const DEFAULT_SCHEMA_NAMESPACE_BASE = DEFAULT_GRAPHS.schema;
const DEFAULT_SHAPES_NAMESPACE_BASE = DEFAULT_GRAPHS.shapes;

/**
 * The class marking attributed-relationship (association) classes (STORY-020): every association
 * class is declared `rdfs:subClassOf` this, replacing the old link-count heuristic with a real,
 * persisted fact. `core:AttributedRelationship` in the original request resolves to this app's own
 * default namespace — no separate `core:` prefix is introduced.
 */
export const ATTRIBUTED_RELATIONSHIP_IRI = `${SCHEMA_NAMESPACE}AttributedRelationship`;

/**
 * Settings vocabulary (Sprint 5 Story 014): a single, fixed, well-known subject holding this app's
 * own configuration triples, mirroring `NAMESPACE_CLASS_IRI`'s self-describing-vocabulary pattern.
 * Replaces the old hardcoded/auto-created `AUTHORITATIVE_ENTITY_IRI` marker class, which collided
 * with a user-created domain class of the same display name in a different namespace (`plan.md`'s
 * Sprint 5 context) — the catalog marker class is now a real, user-owned class the author points at
 * explicitly via `AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI`, not app-reserved infrastructure.
 */
export const APP_SETTINGS_IRI = `${SCHEMA_NAMESPACE}AppSettings`;

/** Predicate on `APP_SETTINGS_IRI` holding the user-configured catalog marker class's IRI as its
 *  object — a class opts into DCAT catalog generation by being declared `rdfs:subClassOf` whatever
 *  class this points at. No auto-lookup/label-matching fallback: unset means nothing is
 *  catalog-eligible (`isAuthoritativeEntity` in `canvas-model.ts`). */
export const AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI = `${SCHEMA_NAMESPACE}authoritativeEntityClass`;

/**
 * Annotation predicate declaring which Backstage `kind` a local class corresponds to (`spec/report/
 * plan.md`, Story 003) — `<classIri> rse:backstageKind "Component"`. Lives in the graph itself, not
 * a Go-side config file, so adding a mapping needs no redeploy (same self-describing-vocabulary
 * rationale as `AUTHORITATIVE_ENTITY_IRI`). Object is a plain string kind, subject a class — the
 * same `owl:AnnotationProperty` OWL-punning shape as `isMasterFor`, harmless since this repo runs no
 * OWL2-RL reasoning.
 */
export const BACKSTAGE_KIND_PREDICATE_IRI = `${SCHEMA_NAMESPACE}backstageKind`;

/**
 * Marker predicate written by a Go sync worker (`backend/internal/sync`) on every individual it
 * creates/updates — `<individual> rse:syncSource "backstage"` (Story 007/010). Part of that
 * worker's own generator-owned predicate set, so it's naturally maintained across re-syncs; read
 * here purely to compute `canvas-model.ts`'s `IndividualNodeSpec.syncSource` flag, the same way
 * `AUTHORITATIVE_ENTITY_CLASS_SETTING_IRI` feeds `isAuthoritativeEntity`. Must match the Go side's
 * `config.Config.SyncSourcePredicateIRI()` exactly — both derive from the same shared
 * `PUBLIC_SCHEMA_NAMESPACE` value.
 */
export const SYNC_SOURCE_PREDICATE_IRI = `${SCHEMA_NAMESPACE}syncSource`;

/**
 * Soft-flag staleness marker (Story 009) — `<individual> rse:syncStatus "stale"` when a
 * previously-synced individual disappeared from its upstream source's latest run. Generator-owned
 * (cleared automatically if the individual reappears), never a human-editable field. Mirrors the Go
 * side's `config.Config.SyncStatusPredicateIRI()`.
 */
export const SYNC_STATUS_PREDICATE_IRI = `${SCHEMA_NAMESPACE}syncStatus`;

/**
 * Namespace-management vocabulary (STORY-027): a namespace's own base IRI is the subject of its
 * own declaration triple, `<base> a <NAMESPACE_CLASS_IRI> ; <NAMESPACE_PREFIX_PREDICATE_IRI>
 * "prefix" ; rdfs:comment "..."`, stored in the default namespace's own `/schema` graph alongside
 * `ATTRIBUTED_RELATIONSHIP_IRI` — this app's own self-describing vocabulary kept in one place.
 */
export const NAMESPACE_CLASS_IRI = `${SCHEMA_NAMESPACE}Namespace`;
export const NAMESPACE_PREFIX_PREDICATE_IRI = `${SCHEMA_NAMESPACE}prefix`;

/**
 * Predicate for a namespace's optional default color (STORY-042) — entities/relations created in
 * a namespace with no per-node color override render using this, ahead of the app's static theme
 * default. Stored the same way as `NAMESPACE_PREFIX_PREDICATE_IRI`, on the namespace's own base-IRI
 * subject.
 */
export const NAMESPACE_COLOR_PREDICATE_IRI = `${SCHEMA_NAMESPACE}color`;

/**
 * Workspace-management vocabulary (STORY-071, `spec/views/plan.md`): a named container a schema
 * author places elements onto so only that container's members render on the canvas at once.
 * Always stored in the default namespace's own `/schema` graph regardless of a Workspace's own
 * optional `defaultNamespace` (research Decision 4), alongside `NAMESPACE_CLASS_IRI`.
 */
export const WORKSPACE_CLASS_IRI = `${SCHEMA_NAMESPACE}Workspace`;

/**
 * A stable, named `(workspace, element)` link resource — not a blank node, so per-member position
 * can be re-targeted by a `DELETE {old} INSERT {new} WHERE {...}` update the way a blank subject
 * can't (research §4).
 */
export const WORKSPACE_MEMBERSHIP_CLASS_IRI = `${SCHEMA_NAMESPACE}WorkspaceMembership`;

/** Links a `WorkspaceMembership` instance to the `Workspace`/element it connects. */
export const WORKSPACE_MEMBERSHIP_WORKSPACE_PREDICATE_IRI = `${SCHEMA_NAMESPACE}workspace`;
export const WORKSPACE_MEMBERSHIP_ELEMENT_PREDICATE_IRI = `${SCHEMA_NAMESPACE}element`;

/**
 * Per-member canvas position on a `WorkspaceMembership` instance — `xsd:decimal`, not
 * `xsd:integer`, since Svelte Flow drag positions aren't guaranteed integers (research §10, the
 * plan's ADR).
 */
export const WORKSPACE_MEMBERSHIP_X_PREDICATE_IRI = `${SCHEMA_NAMESPACE}x`;
export const WORKSPACE_MEMBERSHIP_Y_PREDICATE_IRI = `${SCHEMA_NAMESPACE}y`;

/**
 * A Workspace's optional default namespace — a UI convenience that pre-fills the namespace for new
 * items created while it's active, **not** a storage-location signal (research Decision 4):
 * `Workspace`/`WorkspaceMembership` triples always live in the default namespace's `/schema` graph
 * regardless of this value.
 */
export const WORKSPACE_DEFAULT_NAMESPACE_PREDICATE_IRI = `${SCHEMA_NAMESPACE}defaultNamespace`;

/**
 * Boolean marker set once STORY-075's Default-Workspace migration backfill finishes, letting every
 * later app load skip straight to an `ASK` instead of re-enumerating every element (see STORY-075's
 * concurrency notes, `spec/views/plan.md`'s risk assessment).
 */
export const WORKSPACE_BACKFILL_COMPLETE_PREDICATE_IRI = `${SCHEMA_NAMESPACE}backfillComplete`;

/**
 * SavedQuery vocabulary (STORY-086, `spec/sparql/plan.md`): a named, reusable SPARQL query a
 * schema author can list and re-run later (research Decision 4, §5, §8). Always stored in the
 * default namespace's own `/schema` graph, alongside `NAMESPACE_CLASS_IRI`/`WORKSPACE_CLASS_IRI` —
 * management metadata, not namespace-scoped content.
 */
export const SAVED_QUERY_CLASS_IRI = `${SCHEMA_NAMESPACE}SavedQuery`;

/** The saved query's raw SPARQL text, stored as a plain string literal (escaped via the same
 *  `escapeString()` convention every other literal-bearing insert/update already uses). */
export const SAVED_QUERY_TEXT_PREDICATE_IRI = `${SCHEMA_NAMESPACE}sparqlText`;

/**
 * Note vocabulary (STORY-083, `spec/sparql/story-083-workspace-notes.md`): a free-text sticky note
 * on a Workspace's canvas, optionally pointing at a specific class/individual. Unlike
 * `WorkspaceMembership` (a many-to-many join resource), a Note is a direct 1:1 child of its owning
 * Workspace — one `noteWorkspace` predicate on the Note itself, no join table — so deleting the
 * Workspace deletes its Notes outright. Mirrors the `WORKSPACE_CLASS_IRI`/
 * `WORKSPACE_MEMBERSHIP_CLASS_IRI` block exactly: same file, same `${SCHEMA_NAMESPACE}` prefix,
 * always the default namespace's own `/schema` graph (research Decision 4).
 */
export const NOTE_CLASS_IRI = `${SCHEMA_NAMESPACE}Note`;
export const NOTE_WORKSPACE_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteWorkspace`;
export const NOTE_TEXT_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteText`;
export const NOTE_COLOR_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteColor`;

/** `xsd:decimal`, matching `WORKSPACE_MEMBERSHIP_X/Y_PREDICATE_IRI`'s reasoning — Svelte Flow drag
 *  positions aren't guaranteed integers. */
export const NOTE_X_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteX`;
export const NOTE_Y_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteY`;

/** Optional pointer at the class/individual a Note annotates. */
export const NOTE_LINKED_ELEMENT_PREDICATE_IRI = `${SCHEMA_NAMESPACE}noteLinkedElement`;

/**
 * Fresh Note IRI (STORY-083) — unlike `classIri`/`workspaceIri`, a Note has no user-entered name to
 * derive a stable IRI from, and several blank notes can exist side by side in the same Workspace,
 * so its IRI is **non-deterministic**, minted fresh per creation, mirroring `statementIri`'s
 * `timestamp`-uniqueness pattern rather than `workspaceMembershipIri`'s deterministic
 * two-owner derivation.
 */
export function noteIri(workspaceIriValue: string, timestamp: string): string {
	return `${DEFAULT_SCHEMA_NAMESPACE_BASE}#${extractLocalName(workspaceIriValue)}Note${timestamp}`;
}

/**
 * Split a human-entered name into lowercase word fragments: breaks on non-alphanumeric
 * separators *and* on camelCase/PascalCase boundaries, so a name typed as "VerifyPerson" or
 * "birthDate" round-trips through `pascalCase`/`camelCase` instead of collapsing into one word.
 */
function toWords(name: string): string[] {
	return name
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

function capitalize(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** e.g. "employment assignment" -> "EmploymentAssignment" */
export function pascalCase(name: string): string {
	return toWords(name).map(capitalize).join('');
}

/** e.g. "birth date" -> "birthDate" */
export function camelCase(name: string): string {
	const words = toWords(name);
	if (words.length === 0) return '';
	return [words[0], ...words.slice(1).map(capitalize)].join('');
}

/** e.g. "Application Inventory" -> "application-inventory" (data-catalog Story 008's
 *  `dct:identifier` slug). */
export function kebabCase(name: string): string {
	return toWords(name).join('-');
}

/**
 * Derive a class's IRI from its user-entered name under the given namespace base IRI
 * (`<base>#LocalName`, research.md §12 Decision 2). Called once at creation time; the IRI is then
 * stable for the class's lifetime — renaming only updates `rdfs:label` (see `renameClass`).
 * Defaults to the default namespace's `/schema` base when the caller doesn't pass one explicitly.
 */
export function classIri(name: string, namespaceBaseIri: string = DEFAULT_SCHEMA_NAMESPACE_BASE): string {
	return `${namespaceBaseIri}#${pascalCase(name)}`;
}

/**
 * Derive a Workspace's IRI from its user-entered name (STORY-071) — unlike `classIri`'s second
 * parameter (already the resolved `/schema` graph base), this takes a plain namespace *base* IRI
 * and resolves `.schema` itself, because a Workspace always mints under the **default** namespace's
 * `/schema` base regardless of its own optional `defaultNamespace` (research Decision 4) — there is
 * no legitimate reason for a caller to pass anything but the default. Deterministic and stable
 * across renames (rename only updates `rdfs:label`, matching `classIri`'s convention); concurrent
 * callers minting "the Default workspace" independently converge on the identical IRI, which is
 * what makes STORY-075's client-triggered migration safe under concurrent execution.
 */
export function workspaceIri(name: string, namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI): string {
	return `${namespaceGraphs(namespaceBaseIri).schema}#${pascalCase(name)}Workspace`;
}

/**
 * Derive a SavedQuery's IRI from its user-entered name (STORY-086) — mirrors `workspaceIri`
 * exactly: mints under the default namespace's `/schema` base regardless of the caller's active
 * namespace (research Decision 4). Deterministic and stable across renames.
 */
export function savedQueryIri(
	name: string,
	namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
): string {
	return `${namespaceGraphs(namespaceBaseIri).schema}#${pascalCase(name)}SavedQuery`;
}

/**
 * Derive a datatype/object property's IRI, scoped by its owning class so that two different
 * classes can each have their own "name" or "description" attribute without an IRI clash
 * (uniqueness only needs to hold "on the same entity", per STORY-005's acceptance criteria).
 * Like `classIri`, this is derived once at creation time, stays stable across renames, and mints
 * under the given namespace base IRI (defaulting to the default namespace's `/schema` base).
 */
export function propertyIri(
	ownerClassIri: string,
	propName: string,
	namespaceBaseIri: string = DEFAULT_SCHEMA_NAMESPACE_BASE
): string {
	const ownerLocal = extractLocalName(ownerClassIri);
	const local = camelCase(ownerLocal) + capitalize(camelCase(propName));
	return `${namespaceBaseIri}#${local}`;
}

/**
 * Derive a *generic* (shared) relation's IRI (STORY-051, `spec/modelling-restrictions/plan.md`) —
 * unlike `propertyIri`, deliberately **not** scoped by an owning class: a generic relation is meant
 * to resolve to the same IRI regardless of which source class draws it, so it can be reused across
 * any number of unrelated class pairs without owner-class-scoped collisions. Mints under the given
 * namespace base IRI (defaulting to the default namespace's `/schema` base).
 */
export function genericPropertyIri(
	propName: string,
	namespaceBaseIri: string = DEFAULT_SCHEMA_NAMESPACE_BASE
): string {
	return `${namespaceBaseIri}#${camelCase(propName)}`;
}

/**
 * Deterministic `sh:NodeShape` IRI for a class — no lookup needed, just derived from the class
 * IRI — minted under the given namespace base IRI (defaulting to the default namespace's `/shapes`
 * base).
 */
export function nodeShapeIri(
	ownerClassIri: string,
	namespaceBaseIri: string = DEFAULT_SHAPES_NAMESPACE_BASE
): string {
	return `${namespaceBaseIri}#${extractLocalName(ownerClassIri)}Shape`;
}

/**
 * Deterministic `WorkspaceMembership` IRI for one `(workspace, element)` pair (STORY-071), mirroring
 * `nodeShapeIri`'s two-owning-resource derivation so "does this membership already exist" is an
 * `ASK` against a computed IRI rather than a search. Derived from both inputs' local names (e.g.
 * `#ProjectOverviewWorkspace-Application`, research §8's sketch), minted under the same default
 * `/schema` base as the owning Workspace itself.
 */
export function workspaceMembershipIri(workspaceIriValue: string, elementIri: string): string {
	const workspaceLocal = extractLocalName(workspaceIriValue);
	const elementLocal = extractLocalName(elementIri);
	return `${DEFAULT_SCHEMA_NAMESPACE_BASE}#${workspaceLocal}-${elementLocal}`;
}

/**
 * Derive an individual's (enumerated class member's) IRI from its owning class + user-entered
 * label — e.g. `core:RelationType`'s `nutzt`/`verbucht` members (STORY-019). Scoped by owning
 * class the same way `propertyIri` is, so two different classes can each have a member with the
 * same label without an IRI clash. Derived once at creation time; stable across renames (renaming
 * only updates `rdfs:label`, mirroring `classIri`/`propertyIri`). Unlike `classIri`/`propertyIri`/
 * `nodeShapeIri` (TBox resources, minted under the schema/shapes base), an individual is an ABox
 * resource and mints under the given namespace's plain instances base (STORY-062) — defaulting to
 * `DEFAULT_NAMESPACE_BASE_IRI`, not the schema base.
 */
export function individualIri(
	ownerClassIri: string,
	label: string,
	namespaceBaseIri: string = DEFAULT_NAMESPACE_BASE_IRI
): string {
	const ownerLocal = extractLocalName(ownerClassIri);
	const local = camelCase(ownerLocal) + capitalize(camelCase(label));
	return `${namespaceBaseIri}#${local}`;
}

/**
 * Deterministic `dcat:Catalog` container IRI for a namespace (data-catalog Story 002) — one per
 * namespace, minted under its own `/catalog` graph base, mirroring `nodeShapeIri`'s pattern of
 * deriving a fixed IRI from its owning resource rather than a lookup.
 */
export function catalogIri(namespaceBaseIri: string): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#Catalog`;
}

/**
 * Deterministic `dcat:Dataset` IRI for an `AuthoritativeEntity` subclass (data-catalog Story 002)
 * — one per class, minted under the class's own namespace's `/catalog` graph base.
 */
export function datasetIri(namespaceBaseIri: string, className: string): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#${pascalCase(className)}Dataset`;
}

/**
 * Fresh `prov:Activity` individual IRI for one catalog-generation run against a class
 * (data-catalog Story 002) — unlike `catalogIri`/`datasetIri`, intentionally **not** deterministic:
 * each generation run needs its own IRI so multiple runs against the same class don't collide,
 * hence the required `timestamp` (or any other caller-supplied uniqueness component, e.g. a
 * generated ID) folded into the local name.
 */
export function publicationActivityIri(
	namespaceBaseIri: string,
	className: string,
	timestamp: string
): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#${pascalCase(className)}PublicationActivity${timestamp}`;
}

/**
 * Fresh `rdf:Statement` reification IRI for one relation-edge annotation (relation-assertions
 * Story 008) — like `publicationActivityIri`, intentionally **not** deterministic: reifying the
 * same `(subject, predicate, object)` triple twice would collide unless each occurrence carries
 * its own uniqueness token (a timestamp, or any other caller-supplied unique component). Minted
 * under `namespaceBaseIri` directly (the plain instances base, matching `individualIri`'s own
 * base), not `namespaceGraphs(...).catalog` — a reified statement lives in `graphs.instances`
 * alongside the ground triple it annotates (plan.md's "Reification graph placement" ADR), unlike
 * `publicationActivityIri`'s catalog-graph placement.
 */
export function statementIri(namespaceBaseIri: string, timestamp: string): string {
	return `${namespaceBaseIri}#Statement${timestamp}`;
}

/**
 * Deterministic `dcat:Distribution` IRI for an `AuthoritativeEntity` subclass's catalog entry
 * (data-catalog Story 008/011) — one per class, like `datasetIri`. v1 supports exactly one
 * distribution per dataset (Story 011's per-entity distribution form edits this one node's
 * `dct:format`/`dcat:mediaType`/`dcat:accessURL` fields in place), so a fixed, deterministic IRI
 * lets repeated form submissions target the same node instead of accumulating blank nodes.
 */
export function distributionIri(namespaceBaseIri: string, className: string): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#${pascalCase(className)}Distribution`;
}

/**
 * Deterministic `dcat:Dataset` IRI for an attribute-level `isMasterFor` override's own split
 * dataset (data-catalog Story 020) — one per (class, overriding system) pair, keyed by the
 * system's own local name so the same system reused across multiple attributes on one entity
 * still groups into a single split dataset, and so a regeneration run can recognize an already-
 * generated split dataset by IRI alone (no lookup needed), mirroring `datasetIri`.
 */
export function splitDatasetIri(namespaceBaseIri: string, className: string, systemLocalName: string): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#${pascalCase(className)}${pascalCase(systemLocalName)}Dataset`;
}

/**
 * Deterministic `dcat:Distribution` IRI for a split dataset (data-catalog Story 020), mirroring
 * `distributionIri`'s one-per-dataset pattern.
 */
export function splitDistributionIri(
	namespaceBaseIri: string,
	className: string,
	systemLocalName: string
): string {
	return `${namespaceGraphs(namespaceBaseIri).catalog}#${pascalCase(className)}${pascalCase(systemLocalName)}Distribution`;
}

/** Loose "is this an absolute IRI" check (data-catalog Story 011) — used to validate
 *  `dct:license`/`dct:format`/`dcat:mediaType`/`dcat:accessURL` form input before it's written as
 *  an `<IRI>` term, distinct from `sparql-connector.ts`'s `isSafeSparqlIri` (which guards against
 *  SPARQL-injection characters, not well-formedness). Requires an RFC 3986 scheme followed by `:`
 *  and at least one more character — permissive on purpose, since this only gates "did the user
 *  paste something IRI-shaped", not full RFC 3986 conformance. */
export function isWellFormedIri(value: string): boolean {
	return /^[a-zA-Z][a-zA-Z\d+.-]*:\S+$/.test(value.trim());
}

/** Extract the local name (fragment or last path segment) from an IRI. */
export function extractLocalName(iri: string): string {
	const hashIndex = iri.lastIndexOf('#');
	const slashIndex = iri.lastIndexOf('/');
	const index = Math.max(hashIndex, slashIndex);
	if (index !== -1 && index < iri.length - 1) {
		return decodeURIComponent(iri.substring(index + 1));
	}
	return iri;
}

export const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema#';

/** XSD datatypes offered in the attribute editor, matching the range seen across `gcrm-shema.ttl`. */
export const XSD_DATATYPES = [
	'string',
	'integer',
	'decimal',
	'date',
	'dateTime',
	'boolean',
	'anyURI'
] as const;

export type XsdDatatype = (typeof XSD_DATATYPES)[number];

export function xsdIri(datatype: XsdDatatype): string {
	return `${XSD_NAMESPACE}${datatype}`;
}

const XSD_DATATYPE_SET: ReadonlySet<string> = new Set(XSD_DATATYPES);

/**
 * Reverse of `xsdIri`, used when reconstructing the canvas from GraphDB (STORY-009): given an
 * `rdfs:range` IRI, recover which `XsdDatatype` it is. This app only ever *writes* ranges from
 * `XSD_DATATYPES`, so an unrecognized range can only come from data this app didn't create —
 * falls back to `'string'` rather than dropping the attribute, since round-tripping something is
 * better than silently losing it.
 */
export function xsdDatatypeFromIri(iri: string): XsdDatatype {
	const local = extractLocalName(iri);
	return (XSD_DATATYPE_SET.has(local) ? local : 'string') as XsdDatatype;
}

/**
 * External vocabularies a class can be marked `rdfs:subClassOf` without that class existing as a
 * local node (STORY-008) — the same namespaces `semantic-crm`'s own ontology reuses throughout
 * `gcrm-shema.ttl` (`foaf:Person`, `schema:Organization`, `schema:Person`, etc.).
 */
export const EXTERNAL_PREFIXES: Record<string, string> = {
	foaf: 'http://xmlns.com/foaf/0.1/',
	schema: 'https://schema.org/',
	skos: 'http://www.w3.org/2004/02/skos/core#'
};

/**
 * Marker class for a registered external vocabulary (STORY-046) — `<baseIri> a
 * <SCHEMA_NAMESPACE>ExternalVocabulary ; <SCHEMA_NAMESPACE>prefix "gist"`, stored the same way as
 * `NAMESPACE_CLASS_IRI`/`ATTRIBUTED_RELATIONSHIP_IRI`, in the default namespace's own `/schema`
 * graph, reusing `NAMESPACE_PREFIX_PREDICATE_IRI` rather than introducing a second prefix predicate.
 * Distinct from `NAMESPACE_CLASS_IRI`: a namespace is a domain this app owns and mints IRIs/graphs
 * under, an external vocabulary is only ever referenced, never written to.
 */
export const EXTERNAL_VOCABULARY_CLASS_IRI = `${SCHEMA_NAMESPACE}ExternalVocabulary`;

export interface ResolvedPrefixedName {
	iri: string;
	prefix: string;
	localName: string;
}

/**
 * Resolve a user-typed prefixed name (e.g. "schema:Organization") to a full IRI using `prefixes`
 * (defaults to the three built-in `EXTERNAL_PREFIXES`; callers with GraphDB-registered vocabularies,
 * STORY-046, pass a merged map instead). Returns `null` for anything that isn't `prefix:LocalName`
 * shaped, or whose prefix isn't in `prefixes`.
 */
export function resolvePrefixedName(
	input: string,
	prefixes: Record<string, string> = EXTERNAL_PREFIXES
): ResolvedPrefixedName | null {
	const match = input.trim().match(/^([a-zA-Z][\w-]*):([^\s:][\w.-]*)$/);
	if (!match) return null;
	const [, prefix, localName] = match;
	const namespace = prefixes[prefix];
	if (!namespace) return null;
	return { iri: `${namespace}${localName}`, prefix, localName };
}

/**
 * Reverse of `resolvePrefixedName`, used when reconstructing external-vocabulary stub nodes from
 * GraphDB (STORY-009): given a full IRI, recover its `prefix:LocalName` display form if it falls
 * under one of `prefixes` (defaults to the three built-in `EXTERNAL_PREFIXES`; STORY-046 callers
 * pass a merged map instead). Falls back to the raw IRI for anything else (e.g. a vocabulary this
 * app doesn't know the prefix for) rather than guessing.
 */
export function iriToPrefixedName(iri: string, prefixes: Record<string, string> = EXTERNAL_PREFIXES): string {
	for (const [prefix, namespace] of Object.entries(prefixes)) {
		if (iri.startsWith(namespace)) {
			return `${prefix}:${iri.slice(namespace.length)}`;
		}
	}
	return iri;
}
