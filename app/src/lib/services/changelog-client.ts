/**
 * Browser-side client for `/api/changelog` (ontology-pipeline STORY-331). It sends only the entry's
 * content, never an author or a time; the backend stamps those from the verified user cookie.
 */
import { apiUrl } from '#lib/utils/urls.js';
import type { ChangeLogEntryInput, ChangeLogFilter, ChangeLogItem } from './change-log';

export interface SavedChangeLogEntry {
	iri: string;
	changedBy: string;
	changedAt: string;
}

const ENDPOINT = apiUrl('/changelog');

async function failure(response: Response): Promise<Error> {
	let message = '';
	try {
		const data = (await response.json()) as { message?: unknown };
		if (typeof data.message === 'string') message = data.message;
	} catch {
		/* not JSON: fall through to the status message */
	}
	return new Error(message || `Request failed (${response.status})`);
}

export async function postChangeLogEntry(fetchFn: typeof fetch, entry: ChangeLogEntryInput): Promise<SavedChangeLogEntry> {
	// Only the declared fields travel, whatever the caller's object carries.
	const { kind, summary, rationale, term, question, changeKind, version, namespace } = entry;
	let response: Response;
	try {
		response = await fetchFn(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ kind, summary, rationale, term, question, changeKind, version, namespace })
		});
	} catch {
		throw new Error('Network error — the change log entry was not saved.');
	}
	if (!response.ok) throw await failure(response);
	const data = (await response.json()) as SavedChangeLogEntry;
	return { iri: data.iri, changedBy: data.changedBy, changedAt: data.changedAt };
}

export async function fetchChangeLog(fetchFn: typeof fetch, filter: ChangeLogFilter = {}): Promise<ChangeLogItem[]> {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
	const query = params.toString();
	let response: Response;
	try {
		response = await fetchFn(query ? `${ENDPOINT}?${query}` : ENDPOINT);
	} catch {
		throw new Error('Network error — the change log could not be read.');
	}
	if (!response.ok) throw await failure(response);
	return ((await response.json()) as { entries: ChangeLogItem[] }).entries;
}

/** Records a change with the browser's own `fetch`. */
export const logChange = (entry: ChangeLogEntryInput) => postChangeLogEntry((...args) => fetch(...args), entry);
