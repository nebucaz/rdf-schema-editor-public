import type { XsdDatatype } from './iri';

/** The subset of `CanvasAttributeSpec` (`services/canvas-model.ts`) this module needs — kept as a
 *  structural type rather than importing that one, so this stays a plain, GraphDB/canvas-free utility
 *  (mirrors how `SparqlConnector.fetchIndividualAttributeValues`, STORY-110, takes the same kind of
 *  narrowed shape instead of the full spec). */
export interface AttributeSpecLike {
	iri: string;
	datatype: XsdDatatype;
	required: boolean;
	repeatable: boolean;
}

/** One attribute's live form value: a single string for `repeatable: false`, an array of row strings
 *  (possibly including in-progress empty rows) for `repeatable: true` — the same per-attribute shape
 *  `SparqlConnector.fetchIndividualAttributeValues` (STORY-110) returns, so a fetch result can seed
 *  this directly. */
export type AttributeFormValues = Record<string, string | string[]>;

/** One attribute's persistable change, as computed by `reconcileAttributeValues` — mirrors the
 *  structural shape `SparqlConnector.applyAttributeSubmissions` (STORY-111) expects; neither module
 *  imports the other's type, they just agree on shape. */
export interface AttributeValueSubmission {
	attributeIri: string;
	datatype: XsdDatatype;
	repeatable: boolean;
	/** `repeatable: false` only: the final trimmed value, or `null` to clear. */
	value?: string | null;
	/** `repeatable: true` only: values present in the new state beyond what the original already had
	 *  of the same value (a value repeated twice counts twice — see `diffMultiset`). */
	added?: string[];
	/** `repeatable: true` only: the mirror of `added` — values the original had that the new state
	 *  no longer does. */
	removed?: string[];
}

function normalizeSingle(value: string | string[] | undefined): string {
	if (Array.isArray(value)) return '';
	return (value ?? '').trim();
}

function normalizeRows(value: string | string[] | undefined): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Seeds a fresh `AttributeFormValues` for a class's attribute list — `''` for each single-valued
 *  attribute, `[]` (no rows yet) for each repeatable one. The base case `mergeAttributeFormValues`
 *  builds on for attributes a fetch didn't return a binding for. */
export function emptyAttributeFormValues(attributes: AttributeSpecLike[]): AttributeFormValues {
	const values: AttributeFormValues = {};
	for (const attr of attributes) values[attr.iri] = attr.repeatable ? [] : '';
	return values;
}

/** Merges fetched current values (`SparqlConnector.fetchIndividualAttributeValues`'s return shape)
 *  onto a fresh seed, so every attribute in `attributes` has an entry even when the fetch returned
 *  nothing for it (never had a value set) — used both to pre-populate edit mode and, with an empty
 *  `fetched`, to seed create mode. */
export function mergeAttributeFormValues(
	attributes: AttributeSpecLike[],
	fetched: Record<string, string | string[]>
): AttributeFormValues {
	const values = emptyAttributeFormValues(attributes);
	for (const attr of attributes) {
		const value = fetched[attr.iri];
		if (value === undefined) continue;
		if (attr.repeatable) {
			// Spread rather than reuse the array reference: `fetched` may be a Svelte 5 `$state` proxy
			// (e.g. `IdentityResourcePage.svelte`'s `editAttributeValues`), whose nested arrays are
			// themselves reactive proxies — passing one through unchanged used to leak into
			// `MemberForm.svelte`'s `structuredClone(originalAttributeValues)` and throw
			// `DataCloneError` for any repeatable attribute with an existing value (e.g. a
			// Backstage-synced `Tags` property).
			values[attr.iri] = Array.isArray(value) ? [...value] : [value];
		} else if (!Array.isArray(value)) {
			values[attr.iri] = value;
		}
	}
	return values;
}

/** IRIs of required attributes left empty in `values` — a single-valued attribute needs a non-blank
 *  value, a repeatable one needs at least one non-blank row. An empty return means submit can
 *  proceed. */
export function validateRequiredAttributes(attributes: AttributeSpecLike[], values: AttributeFormValues): string[] {
	const missing: string[] = [];
	for (const attr of attributes) {
		if (!attr.required) continue;
		const hasValue = attr.repeatable
			? normalizeRows(values[attr.iri]).length > 0
			: normalizeSingle(values[attr.iri]).length > 0;
		if (!hasValue) missing.push(attr.iri);
	}
	return missing;
}

/** Multiset diff: `added` is what `next` has beyond what `prev` already contained of the same value,
 *  `removed` is the reverse — a value present in both isn't churned, only the count difference is
 *  (so typing the same nickname into two rows and removing one produces no writes at all). */
function diffMultiset(prev: string[], next: string[]): { added: string[]; removed: string[] } {
	const remaining = new Map<string, number>();
	for (const v of prev) remaining.set(v, (remaining.get(v) ?? 0) + 1);

	const added: string[] = [];
	for (const v of next) {
		const count = remaining.get(v) ?? 0;
		if (count > 0) remaining.set(v, count - 1);
		else added.push(v);
	}

	const removed: string[] = [];
	for (const [v, count] of remaining) {
		for (let i = 0; i < count; i++) removed.push(v);
	}
	return { added, removed };
}

/**
 * Diffs `original` (the values a form started with — fetched, or empty in create mode) against
 * `current` (live form state) into exactly the writes `SparqlConnector.applyAttributeSubmissions`
 * needs to perform: single-valued attributes via replace/clear (only when the trimmed value actually
 * changed), repeatable ones via an add/remove multiset diff (only actually-changed rows produce a
 * write, per STORY-111's AC). An attribute with no change at all is omitted from the result.
 */
export function reconcileAttributeValues(
	attributes: AttributeSpecLike[],
	original: AttributeFormValues,
	current: AttributeFormValues
): AttributeValueSubmission[] {
	const submissions: AttributeValueSubmission[] = [];
	for (const attr of attributes) {
		if (attr.repeatable) {
			const { added, removed } = diffMultiset(normalizeRows(original[attr.iri]), normalizeRows(current[attr.iri]));
			if (added.length > 0 || removed.length > 0) {
				submissions.push({ attributeIri: attr.iri, datatype: attr.datatype, repeatable: true, added, removed });
			}
		} else {
			const prev = normalizeSingle(original[attr.iri]);
			const next = normalizeSingle(current[attr.iri]);
			if (prev !== next) {
				submissions.push({
					attributeIri: attr.iri,
					datatype: attr.datatype,
					repeatable: false,
					value: next === '' ? null : next
				});
			}
		}
	}
	return submissions;
}
