/**
 * Pure helpers behind annotation badges on result cells (query-workbench STORY-199): which facts a
 * page of results stands for, the single batched lookup, and how an annotation is summarised and
 * attributed. No Svelte, no DOM — the table only renders what this returns.
 */
import { factKeyString, type FactKey, type FetchedAnnotation } from './sparql-connector';
import type { CellFact, ResultRows } from './query-results';
import { extractLocalName } from '../utils/iri';

/** The slice of `SparqlConnector` the badge loader needs. */
export interface AnnotationSource {
	fetchAnnotationsForFacts(facts: FactKey[]): Promise<Map<string, FetchedAnnotation[]>>;
}

export interface BadgeUser {
	sub: string;
	displayName: string;
}

export function toFactKey(fact: CellFact): FactKey {
	const { object } = fact;
	return {
		subjectIri: fact.subjectIri,
		predicateIri: fact.predicateIri,
		object: object.isIri
			? { kind: 'iri', iri: object.value }
			: {
					kind: 'literal',
					value: object.value,
					...(object.datatype ? { datatype: object.datatype } : {}),
					...(object.lang ? { lang: object.lang } : {})
				}
	};
}

/** Every distinct fact a page of results stands for. Aggregate rows/measures carry none. */
export function collectFactKeys(table: ResultRows): FactKey[] {
	const seen = new Map<string, FactKey>();
	for (const row of table.rows) {
		for (const cell of row) {
			if (!cell.fact) continue;
			const key = toFactKey(cell.fact);
			seen.set(factKeyString(key), key);
		}
	}
	return [...seen.values()];
}

/**
 * One batched request per page (STORY-182). A failure must never break the table, so it degrades
 * to "no badges" with a console warning.
 */
export async function loadPageAnnotations(
	source: AnnotationSource,
	table: ResultRows
): Promise<Map<string, FetchedAnnotation[]>> {
	const facts = collectFactKeys(table);
	if (facts.length === 0) return new Map();
	try {
		return await source.fetchAnnotationsForFacts(facts);
	} catch (e) {
		console.warn('Could not load annotations for this page; showing results without badges.', e);
		return new Map();
	}
}

export function annotationsForFact(
	annotations: ReadonlyMap<string, FetchedAnnotation[]>,
	fact: CellFact | undefined
): FetchedAnnotation[] {
	if (!fact) return [];
	return annotations.get(factKeyString(toFactKey(fact))) ?? [];
}

/** Badge text: the label itself for a lone enumerated label, otherwise the annotation count. */
export function badgeSummary(
	annotations: readonly FetchedAnnotation[]
): { text: string; count: number } | null {
	if (annotations.length === 0) return null;
	const only = annotations.length === 1 ? annotations[0] : undefined;
	if (only?.type === 'label') {
		return {
			text: only.labelText ?? extractLocalName(only.labelIri ?? ''),
			count: 1
		};
	}
	return { text: String(annotations.length), count: annotations.length };
}

/**
 * There is no identity directory yet (recorded limitation): the stored `sub` is shown, except for
 * the current user's own annotations, which show their display name.
 */
export function authorDisplay(annotatedBy: string, user: BadgeUser | null | undefined): string {
	return user && annotatedBy === user.sub ? user.displayName : annotatedBy;
}

export function formatAnnotatedAt(iso: string): string {
	const time = Date.parse(iso);
	if (Number.isNaN(time)) return iso;
	return new Date(time).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

export interface AnnotationView {
	iri: string;
	kind: 'text' | 'label';
	content: string;
	author: string;
	date: string;
}

export function describeAnnotation(
	a: FetchedAnnotation,
	user: BadgeUser | null | undefined
): AnnotationView {
	return {
		iri: a.iri,
		kind: a.type,
		content:
			a.type === 'label'
				? (a.labelText ?? extractLocalName(a.labelIri ?? ''))
				: (a.text ?? ''),
		author: authorDisplay(a.annotatedBy, user),
		date: formatAnnotatedAt(a.annotatedAt)
	};
}
