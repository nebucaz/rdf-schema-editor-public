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
 * The class marking a catalog-eligible entity (data-catalog Story 003): a class opts into DCAT
 * catalog generation by being declared `rdfs:subClassOf` this, exactly mirroring
 * `ATTRIBUTED_RELATIONSHIP_IRI`'s marker pattern — no link-count or naming heuristic.
 */
export const AUTHORITATIVE_ENTITY_IRI = `${SCHEMA_NAMESPACE}AuthoritativeEntity`;

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
