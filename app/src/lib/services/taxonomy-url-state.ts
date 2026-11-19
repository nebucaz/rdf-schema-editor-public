import { appUrl } from '#lib/utils/urls.js';

/** What the Taxonomy page keeps in its address: the outline or the graph, and the scheme shown. */
export const TAXONOMY_VIEWS = ['outline', 'graph'] as const;
export type TaxonomyView = (typeof TAXONOMY_VIEWS)[number];

export interface TaxonomyUrlState {
	view: TaxonomyView;
	/** `''` is the first scheme. */
	scheme: string;
}

type ParamsLike = { get(name: string): string | null; toString(): string };

export function parseTaxonomyUrlState(params: ParamsLike): TaxonomyUrlState {
	return { view: params.get('view') === 'graph' ? 'graph' : 'outline', scheme: params.get('scheme') ?? '' };
}

/** `path` is app-relative; every other query parameter is kept and the defaults are left out. */
export function taxonomyHref(path: string, current: ParamsLike, state: TaxonomyUrlState): string {
	const next = new URLSearchParams(current.toString());
	next.delete('view');
	next.delete('scheme');
	if (state.view !== 'outline') next.set('view', state.view);
	if (state.scheme) next.set('scheme', state.scheme);
	const search = next.toString();
	return appUrl(path) + (search ? `?${search}` : '');
}

/** The Concepts tab with one concept open. */
export function conceptInVocabularyHref(iri: string): string {
	return `${appUrl('/vocabulary')}?concept=${encodeURIComponent(iri)}`;
}
