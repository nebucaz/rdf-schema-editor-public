/**
 * URL query-param round-trip for the Identities route (STORY-118), mirroring `semantic-crm`'s
 * `?q=`/`?p=`/`?node=` pattern (`+page.svelte:37-44`) — the current search text, active facets, and
 * selected resource-page IRI all live in the URL so a filtered view (and an open resource page) is
 * bookmarkable/shareable and survives Back/Forward. Pure functions, no `$app/navigation`/`page`
 * dependency, so they're unit-testable without a live SvelteKit router (this repo's existing
 * colocated `*.spec.ts` convention).
 */

export interface IdentitySearchUrlParams {
	query: string;
	classIri: string | null;
	namespaceBaseIri: string | null;
	syncSource: string | null;
	syncStatus: string | null;
	/** The IRI of the identity currently open on the resource-page half of the route, if any. */
	node: string | null;
}

const EMPTY_PARAMS: IdentitySearchUrlParams = {
	query: '',
	classIri: null,
	namespaceBaseIri: null,
	syncSource: null,
	syncStatus: null,
	node: null
};

/** Parses a `URL.search`-shaped string (e.g. `page.url.search`, with or without its leading `?`)
 *  into the route's state shape. An absent/blank param becomes `''`/`null`, never `undefined`, so
 *  callers can diff the result against current state with plain `!==`. */
export function parseIdentitySearchParams(search: string): IdentitySearchUrlParams {
	const params = new URLSearchParams(search);
	return {
		query: params.get('q') ?? '',
		classIri: params.get('class'),
		namespaceBaseIri: params.get('ns'),
		syncSource: params.get('source'),
		syncStatus: params.get('status'),
		node: params.get('node')
	};
}

/** Inverse of `parseIdentitySearchParams`: builds the `/identities` path (with query string) for a
 *  given state, omitting any empty/`null` field entirely rather than writing it as `""`. */
export function buildIdentitySearchUrl(params: Partial<IdentitySearchUrlParams>): string {
	const { query, classIri, namespaceBaseIri, syncSource, syncStatus, node } = {
		...EMPTY_PARAMS,
		...params
	};
	const usp = new URLSearchParams();
	if (query) usp.set('q', query);
	if (classIri) usp.set('class', classIri);
	if (namespaceBaseIri) usp.set('ns', namespaceBaseIri);
	if (syncSource) usp.set('source', syncSource);
	if (syncStatus) usp.set('status', syncStatus);
	if (node) usp.set('node', node);
	const qs = usp.toString();
	return qs ? `/identities?${qs}` : '/identities';
}
