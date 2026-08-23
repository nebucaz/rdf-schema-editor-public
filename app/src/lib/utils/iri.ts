/**
 * IRI generation utilities for the schema/shapes graph this app maintains, mirroring
 * `semantic-crm`'s `lib/utils/iri.ts` approach but using this project's own namespace
 * (independent app, own GraphDB repository — see `spec/setup/plan.md`'s ADR table).
 */

export { SCHEMA_NAMESPACE, SHAPES_NAMESPACE } from '$lib/config';
import { SCHEMA_NAMESPACE, SHAPES_NAMESPACE } from '$lib/config';

/**
 * The class marking attributed-relationship (association) classes (STORY-020): every association
 * class is declared `rdfs:subClassOf` this, replacing the old link-count heuristic with a real,
 * persisted fact. `core:AttributedRelationship` in the original request resolves to this app's own
 * `SCHEMA_NAMESPACE` — no separate `core:` prefix is introduced.
 */
export const ATTRIBUTED_RELATIONSHIP_IRI = `${SCHEMA_NAMESPACE}AttributedRelationship`;

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

/**
 * Derive a class's IRI from its user-entered name. Called once at creation time; the IRI is
 * then stable for the class's lifetime — renaming only updates `rdfs:label` (see `renameClass`).
 */
export function classIri(name: string): string {
	return `${SCHEMA_NAMESPACE}${pascalCase(name)}`;
}

/**
 * Derive a datatype/object property's IRI, scoped by its owning class so that two different
 * classes can each have their own "name" or "description" attribute without an IRI clash
 * (uniqueness only needs to hold "on the same entity", per STORY-005's acceptance criteria).
 * Like `classIri`, this is derived once at creation time and stays stable across renames.
 */
export function propertyIri(ownerClassIri: string, propName: string): string {
	const ownerLocal = extractLocalName(ownerClassIri);
	const local = camelCase(ownerLocal) + capitalize(camelCase(propName));
	return `${SCHEMA_NAMESPACE}${local}`;
}

/** Deterministic `sh:NodeShape` IRI for a class — no lookup needed, just derived from the class IRI. */
export function nodeShapeIri(ownerClassIri: string): string {
	return `${SHAPES_NAMESPACE}${extractLocalName(ownerClassIri)}Shape`;
}

/**
 * Derive an individual's (enumerated class member's) IRI from its owning class + user-entered
 * label — e.g. `core:RelationType`'s `nutzt`/`verbucht` members (STORY-019). Scoped by owning
 * class the same way `propertyIri` is, so two different classes can each have a member with the
 * same label without an IRI clash. Derived once at creation time; stable across renames (renaming
 * only updates `rdfs:label`, mirroring `classIri`/`propertyIri`).
 */
export function individualIri(ownerClassIri: string, label: string): string {
	const ownerLocal = extractLocalName(ownerClassIri);
	const local = camelCase(ownerLocal) + capitalize(camelCase(label));
	return `${SCHEMA_NAMESPACE}${local}`;
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

export interface ResolvedPrefixedName {
	iri: string;
	prefix: string;
	localName: string;
}

/**
 * Resolve a user-typed prefixed name (e.g. "schema:Organization") to a full IRI using
 * `EXTERNAL_PREFIXES`. Returns `null` for anything that isn't `prefix:LocalName` shaped, or whose
 * prefix isn't one of the known external vocabularies.
 */
export function resolvePrefixedName(input: string): ResolvedPrefixedName | null {
	const match = input.trim().match(/^([a-zA-Z][\w-]*):([^\s:][\w.-]*)$/);
	if (!match) return null;
	const [, prefix, localName] = match;
	const namespace = EXTERNAL_PREFIXES[prefix];
	if (!namespace) return null;
	return { iri: `${namespace}${localName}`, prefix, localName };
}

/**
 * Reverse of `resolvePrefixedName`, used when reconstructing external-vocabulary stub nodes from
 * GraphDB (STORY-009): given a full IRI, recover its `prefix:LocalName` display form if it falls
 * under one of `EXTERNAL_PREFIXES`. Falls back to the raw IRI for anything else (e.g. a vocabulary
 * this app doesn't know the prefix for) rather than guessing.
 */
export function iriToPrefixedName(iri: string): string {
	for (const [prefix, namespace] of Object.entries(EXTERNAL_PREFIXES)) {
		if (iri.startsWith(namespace)) {
			return `${prefix}:${iri.slice(namespace.length)}`;
		}
	}
	return iri;
}
