import { appUrl } from '#lib/utils/urls.js';
import { CONCEPT_STATUSES, type ConceptStatus } from './skos-concept.js';

/** The tabs of the Vocabulary page, in display order. */
export const VOCABULARY_TABS = ['concepts', 'schemes', 'collections'] as const;
export type VocabularyTab = (typeof VOCABULARY_TABS)[number];

/** What the address bar remembers about a list: the tab, the search text, the 1-based page and the scheme filter. */
export interface ListUrlState {
	tab: VocabularyTab;
	q: string;
	page: number;
	scheme: string;
	/** Concepts tab only; `''` is every status. */
	status: ConceptStatus | '';
}

export const DEFAULT_LIST_STATE: ListUrlState = { tab: 'concepts', q: '', page: 1, scheme: '', status: '' };

/** `URLSearchParams` or SvelteKit's read-only one. */
type ParamsLike = { get(name: string): string | null; toString(): string };

const KEYS = ['tab', 'q', 'page', 'scheme', 'status'] as const;

/** Reads the state from a query string; anything unknown or malformed becomes the default. */
export function parseListUrlState(params: ParamsLike): ListUrlState {
	const tab = params.get('tab');
	const page = params.get('page') ?? '';
	const status = params.get('status') ?? '';
	return {
		tab: (VOCABULARY_TABS as readonly string[]).includes(tab ?? '') ? (tab as VocabularyTab) : DEFAULT_LIST_STATE.tab,
		q: params.get('q') ?? '',
		page: /^[1-9]\d*$/.test(page) && Number.isSafeInteger(Number(page)) ? Number(page) : 1,
		scheme: params.get('scheme') ?? '',
		status: (CONCEPT_STATUSES as readonly string[]).includes(status) ? (status as ConceptStatus) : ''
	};
}

/** A copy of `params` with the four list keys set from `state` (defaults are removed so the default view has a
 *  clean URL); every other parameter, such as `concept`, is kept. */
export function withListState(params: ParamsLike, state: ListUrlState): URLSearchParams {
	const next = new URLSearchParams(params.toString());
	for (const key of KEYS) next.delete(key);
	if (state.tab !== DEFAULT_LIST_STATE.tab) next.set('tab', state.tab);
	if (state.q) next.set('q', state.q);
	if (state.page !== 1) next.set('page', String(state.page));
	if (state.scheme) next.set('scheme', state.scheme);
	if (state.status) next.set('status', state.status);
	return next;
}

/** Applies a change; a new search, scheme or tab starts again at page 1 unless the change names a page. */
export function patchListState(state: ListUrlState, patch: Partial<ListUrlState>): ListUrlState {
	const next = { ...state, ...patch };
	const filterChanged = next.q !== state.q || next.scheme !== state.scheme || next.status !== state.status || next.tab !== state.tab;
	return patch.page === undefined && filterChanged ? { ...next, page: 1 } : next;
}

/** The target for `goto(..., { replace: true })`: `path` is app-relative (`stripBase(pathname)`), the result
 *  carries the deployment base path. */
export function listStateHref(path: string, current: ParamsLike, state: ListUrlState): string {
	const search = withListState(current, state).toString();
	return appUrl(path) + (search ? `?${search}` : '');
}
