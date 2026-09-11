/**
 * Pure display-formatting helpers for STORY-119's identity resource page, ported from
 * `semantic-crm`'s `NodeDetailPanel.svelte` (`prettify`/`localName`/`formatLiteralValue`) and
 * `ResultsList.svelte` (the same `prettify`/`localName` pair, duplicated there). Extracted into
 * their own module — rather than living inline in a `.svelte` file — so they're covered by this
 * repo's colocated `*.spec.ts` convention without needing a component-testing project (see
 * `CLAUDE.md`'s "known gap" note).
 */
import { RDF, RDFS } from '$lib/services/turtle';
import type { ResourcePageTriple } from '$lib/services/sparql-connector';
import { extractLocalName } from './iri';

/** Core word-splitting transform behind `prettifyLocalName`/`displayLabel` — camelCase and
 *  `_`/`-` separators become spaces, only the very first character is capitalized (matching
 *  `semantic-crm`'s ported `prettify` exactly, not per-word title-casing). Safe to run on text
 *  that's already human-formatted (a real `rdfs:label` like "John Smith" round-trips unchanged). */
function prettify(raw: string): string {
	return raw
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^./, (c) => c.toUpperCase());
}

/** Prettifies an IRI's local name for display when no `rdfs:label` is available at all — e.g.
 *  `employmentStartDate` / `employment-start-date` -> "Employment Start Date". Port of
 *  `NodeDetailPanel.svelte`/`ResultsList.svelte`'s identical `prettify(localName(iri))` pair. */
export function prettifyLocalName(iri: string): string {
	return prettify(extractLocalName(iri));
}

/** A predicate/subject's display label: its resolved `rdfs:label` if one was found, else a
 *  prettified local name — never a raw IRI (STORY-119 AC). Use when the caller has a label field
 *  that may be undefined/null (no lookup was attempted at all), alongside the IRI it names. */
export function labelOrPrettify(label: string | undefined | null, iri: string): string {
	return label && label.trim() ? label : prettifyLocalName(iri);
}

/** STORY-116's `fetchResourcePage`/`searchIndividuals` already guarantee a non-null label string
 *  (falling back to `extractLocalName`, `sparql-connector.ts`'s existing convention) but don't
 *  distinguish "this is a real `rdfs:label`" from "this is that raw local-name fallback" in the
 *  value itself — so a fallback like `employmentStartDate` reaches the UI unprettified. Re-running
 *  the same `prettify` word-split here is a safe no-op on a genuine label (already human-formatted
 *  text round-trips unchanged, see `prettify`'s own doc comment) and closes that gap for the
 *  fallback case, without changing Sprint 1's already-shipped/tested connector return shape. */
export function displayLabel(label: string): string {
	return prettify(label);
}

/** Formats a literal value for display, applying date/dateTime formatting per the ported original
 *  (`NodeDetailPanel.svelte`'s `formatLiteralValue`) — every other datatype passes through as-is. */
export function formatLiteralValue(value: string, datatype?: string): string {
	if (!datatype) return value;
	if (datatype.includes('date') || datatype.includes('dateTime')) {
		const timestamp = Date.parse(value);
		if (!Number.isNaN(timestamp)) {
			return new Date(timestamp).toLocaleString();
		}
	}
	return value;
}

export interface ResourceHeaderInfo {
	/** The resource's own `rdfs:label` literal, if `fetchResourcePage` returned one among its
	 *  outgoing triples; falls back to a prettified local name of its IRI otherwise. */
	label: string;
	/** Every `rdf:type` object IRI found among the resource's outgoing triples, in encounter order. */
	typeIris: string[];
}

/** Derives the resource page's header (label + `rdf:type`(s)) from `fetchResourcePage`'s flat
 *  outgoing-triple list — `ResourcePage` carries no separate `label`/`types` field of its own, so
 *  both are pulled out of `outgoing` here rather than requeried. */
export function deriveResourceHeader(iri: string, outgoing: ResourcePageTriple[]): ResourceHeaderInfo {
	const labelTriple = outgoing.find((t) => t.predicateIri === RDFS.label && t.objectType === 'literal');
	const typeIris = outgoing
		.filter((t) => t.predicateIri === RDF.type && t.objectType === 'uri')
		.map((t) => t.object);
	return { label: labelOrPrettify(labelTriple?.object, iri), typeIris };
}

export interface SplitOutgoingTriples {
	literalTriples: ResourcePageTriple[];
	uriTriples: ResourcePageTriple[];
}

/** Splits `fetchResourcePage`'s outgoing triples into literal- vs URI-valued halves for display
 *  (STORY-119 AC), mirroring `NodeDetailPanel.svelte`'s `literalTriples`/`outgoingLinks` derived
 *  split. `rdf:type` and `rdfs:label` are excluded from both halves since `deriveResourceHeader`
 *  already surfaces them in the page header — showing them again in the properties/links list would
 *  just duplicate the header. */
export function splitOutgoingTriples(outgoing: ResourcePageTriple[]): SplitOutgoingTriples {
	const rest = outgoing.filter((t) => t.predicateIri !== RDF.type && t.predicateIri !== RDFS.label);
	return {
		literalTriples: rest.filter((t) => t.objectType === 'literal'),
		uriTriples: rest.filter((t) => t.objectType === 'uri')
	};
}
