/**
 * Report ids (STORY-198): the URL segment of `/reports/<id>` for a saved query, and the lookup
 * from a segment back to the query. Pure — no GraphDB, no Svelte.
 *
 * A saved query is always minted under the default namespace's `/schema` graph
 * (`savedQueryIri`), so its id is just the IRI's local name (`ProdAppsSavedQuery`). Anything else
 * (a hand-registered query elsewhere) falls back to `~` + base64url(IRI). The id is only ever
 * compared against fetched queries' IRIs — it is never interpolated into SPARQL.
 */
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '../config';
import { parseQueryModel, type QueryModel } from './query-model';
import { fromBase64Url, toBase64Url } from '../utils/base64url';
import { openSavedQuery, type SavedQueryItem } from './saved-queries';

const BASE = `${namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema}#`;
const LOCAL_NAME = /^[A-Za-z0-9_-]+$/;
const ENCODED = /^~[A-Za-z0-9_-]+$/;

export function reportIdForIri(iri: string): string {
	if (iri.startsWith(BASE)) {
		const local = iri.slice(BASE.length);
		if (LOCAL_NAME.test(local)) return local;
	}
	return `~${toBase64Url(iri)}`;
}

/** `null` for anything that is not a well-formed report id. */
export function iriForReportId(id: string): string | null {
	if (LOCAL_NAME.test(id)) return `${BASE}${id}`;
	if (!ENCODED.test(id)) return null;
	const iri = fromBase64Url(id.slice(1));
	// Same guard class as `isSafeSparqlIri`: an absolute http(s) IRI without IRIREF-breaking chars.
	if (!iri || !/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(iri)) return null;
	return iri;
}

export type ReportTarget =
	| { kind: 'notFound' }
	| { kind: 'legacy'; item: SavedQueryItem; text: string }
	| { kind: 'invalid'; item: SavedQueryItem; message: string }
	| { kind: 'ready'; item: SavedQueryItem; model: QueryModel };

export function resolveReportTarget(items: readonly SavedQueryItem[], id: string): ReportTarget {
	const iri = iriForReportId(id);
	const item = iri === null ? undefined : items.find((i) => i.iri === iri);
	if (!item) return { kind: 'notFound' };
	const opened = openSavedQuery(item);
	if (opened.kind === 'sparql') return { kind: 'legacy', item, text: opened.text };
	if (opened.kind === 'error') return { kind: 'invalid', item, message: opened.message };
	return { kind: 'ready', item, model: opened.model };
}
