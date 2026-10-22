/**
 * Share links (query-workbench STORY-201). Pure: builds the links for a saved or ad-hoc query and
 * decides what the workbench should load from its URL. Nothing here trusts URL input — inline
 * models go through `decodeModelFromUrl` (strict parse), saved ids through `resolveReportTarget`.
 */
import { decodeModelFromUrl, encodeModelForUrl, parseQueryModel, type QueryModel } from './query-model';
import { isShortId } from './short-links';
import { reportIdForIri, resolveReportTarget } from './report-id';
import type { SavedQueryItem } from './saved-queries';

export function savedQueryLinks(origin: string, iri: string): { builder: string; report: string } {
	const id = encodeURIComponent(reportIdForIri(iri));
	return { builder: `${origin}/workbench?query=${id}`, report: `${origin}/reports/${id}` };
}

/** Reserved `/reports/<id>` segment for an unsaved query carried in `?m=`. Saved ids are PascalCase
 *  local names or `~`-prefixed, so this lowercase word can never collide with one. */
export const AD_HOC_REPORT_ID = 'adhoc';

export type AdHocLink = { ok: true; url: string } | { ok: false; error: string };

export function adHocLink(origin: string, model: QueryModel): AdHocLink {
	const enc = encodeModelForUrl(model);
	return enc.ok
		? { ok: true, url: `${origin}/workbench?m=${enc.param}` }
		: { ok: false, error: enc.error };
}

/** Read-only result link for an unsaved query: the report page, model inline in `?m=`. */
export function adHocReportLink(origin: string, model: QueryModel): AdHocLink {
	const enc = encodeModelForUrl(model);
	return enc.ok
		? { ok: true, url: `${origin}/reports/${AD_HOC_REPORT_ID}?m=${enc.param}` }
		: { ok: false, error: enc.error };
}

export type SharedLoad =
	| { kind: 'none' }
	| { kind: 'model'; model: QueryModel }
	| { kind: 'console'; text: string }
	| { kind: 'error'; message: string };

export function resolveSharedLoad(
	params: URLSearchParams,
	savedItems: readonly SavedQueryItem[]
): SharedLoad {
	const queryId = params.get('query');
	if (queryId !== null) {
		const target = resolveReportTarget(savedItems, queryId);
		switch (target.kind) {
			case 'ready':
				return { kind: 'model', model: target.model };
			case 'legacy':
				return { kind: 'console', text: target.text };
			case 'invalid':
				return { kind: 'error', message: target.message };
			default:
				return { kind: 'error', message: 'The shared query was not found. It may have been deleted.' };
		}
	}
	const inline = params.get('m');
	if (inline !== null) {
		const decoded = decodeModelFromUrl(inline);
		return decoded.ok ? { kind: 'model', model: decoded.model } : { kind: 'error', message: decoded.error };
	}
	return { kind: 'none' };
}

export type ShortLinkResult = { ok: true; model: QueryModel } | { ok: false; error: string };

const SHORT_LINK_NOT_FOUND = 'The shared query was not found. The link may be wrong.';

/** Resolves `?q=<id>` through `GET /api/shared-queries/<id>`; a malformed id never leaves the browser. */
export async function fetchShortLinkModel(
	id: string,
	fetchImpl: typeof fetch
): Promise<ShortLinkResult> {
	if (!isShortId(id)) return { ok: false, error: SHORT_LINK_NOT_FOUND };
	let res: Response;
	try {
		res = await fetchImpl(`/api/shared-queries/${id}`);
	} catch {
		return { ok: false, error: 'The shared query could not be loaded. Check your connection and try again.' };
	}
	if (res.status === 404) return { ok: false, error: SHORT_LINK_NOT_FOUND };
	if (!res.ok) return { ok: false, error: 'The shared query could not be loaded. Try again later.' };
	const body = await res.json().catch(() => null);
	const parsed = parseQueryModel(JSON.stringify(body?.model ?? null));
	return parsed.ok ? { ok: true, model: parsed.model } : { ok: false, error: 'The shared query is damaged and could not be read.' };
}
