/**
 * Pure helpers for editing annotations in place (query-workbench STORY-200): immutable edits of the
 * page's `factKey → annotations` map, the pending (optimistic) entry, and the apply → request →
 * commit-or-rollback runner. No Svelte, no network — the table wires these to the real client.
 */
import type { AnnotationInput, FetchedAnnotation } from './sparql-connector';
import { extractLocalName } from '../utils/iri';

export type AnnotationMap = ReadonlyMap<string, FetchedAnnotation[]>;

const PENDING_PREFIX = 'urn:pending-annotation:';

/** Appends (or inserts at `index`) an annotation for one fact, returning a new map. */
export function withAnnotation(
	map: AnnotationMap,
	factKey: string,
	annotation: FetchedAnnotation,
	index?: number
): Map<string, FetchedAnnotation[]> {
	const next = new Map(map);
	const list = [...(map.get(factKey) ?? [])];
	if (index === undefined || index >= list.length) list.push(annotation);
	else list.splice(Math.max(0, index), 0, annotation);
	next.set(factKey, list);
	return next;
}

/** Removes one annotation by IRI; returns the same map when there is nothing to remove. */
export function withoutAnnotation(
	map: AnnotationMap,
	factKey: string,
	iri: string
): Map<string, FetchedAnnotation[]> {
	const list = map.get(factKey);
	if (!list || !list.some((a) => a.iri === iri)) return map as Map<string, FetchedAnnotation[]>;
	const next = new Map(map);
	next.set(factKey, list.filter((a) => a.iri !== iri));
	return next;
}

/** Swaps a pending entry for the server-confirmed annotation, keeping its position. */
export function withReplacedAnnotation(
	map: AnnotationMap,
	factKey: string,
	pendingIri: string,
	confirmed: FetchedAnnotation
): Map<string, FetchedAnnotation[]> {
	const list = map.get(factKey);
	if (!list) return withAnnotation(map, factKey, confirmed);
	const next = new Map(map);
	next.set(factKey, list.map((a) => (a.iri === pendingIri ? confirmed : a)));
	return next;
}

/** The entry shown while the request is in flight. `seq` makes each pending IRI distinct. */
export function pendingAnnotation(
	input: AnnotationInput,
	user: { sub: string; displayName: string },
	labels: { iri: string; label: string }[] | undefined,
	seq: number
): FetchedAnnotation {
	const base = {
		iri: `${PENDING_PREFIX}${seq}`,
		annotatedBy: user.sub,
		annotatedAt: new Date().toISOString()
	};
	if (input.type === 'text') return { ...base, type: 'text', text: input.text };
	return {
		...base,
		type: 'label',
		labelIri: input.labelIri,
		labelText:
			labels?.find((l) => l.iri === input.labelIri)?.label ?? extractLocalName(input.labelIri)
	};
}

export function isPendingAnnotation(a: FetchedAnnotation): boolean {
	return a.iri.startsWith(PENDING_PREFIX);
}

/**
 * Optimistic update: `apply` immediately, run the `request`, then `commit` its result — or
 * `rollback` and rethrow so the caller can show the error and leave state consistent.
 */
export async function runOptimistic<T>(steps: {
	apply: () => void;
	request: () => Promise<T>;
	commit: (result: T) => void;
	rollback: () => void;
}): Promise<T> {
	steps.apply();
	try {
		const result = await steps.request();
		steps.commit(result);
		return result;
	} catch (e) {
		steps.rollback();
		throw e;
	}
}

/** Why the annotation panel is read-only, or `null` when the user may annotate. */
export function annotateDisabledReason(
	user: { sub: string; displayName: string } | null | undefined
): string | null {
	return user
		? null
		: 'Annotating needs a user identity — no valid user token is configured, so annotations are read-only.';
}
