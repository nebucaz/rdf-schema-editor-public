/**
 * Browser-side client for `/api/annotations` (query-workbench STORY-200). It sends only the fact and
 * the annotation content — never an author or timestamp; the SvelteKit route stamps those from the
 * server-side user identity (STORY-183), so they cannot be forged through this UI.
 */
import type { AnnotationInput, FactKey } from './sparql-connector';

export interface SavedAnnotation {
	iri: string;
	annotatedBy: string;
	annotatedAt: string;
}

const ENDPOINT = '/api/annotations';

async function send(fetchFn: typeof fetch, method: 'POST' | 'DELETE', body: unknown): Promise<Response> {
	let response: Response;
	try {
		response = await fetchFn(ENDPOINT, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		throw new Error('Network error — the change was not saved.');
	}
	if (response.ok) return response;
	let message = '';
	try {
		const data = (await response.json()) as { message?: unknown };
		if (typeof data.message === 'string') message = data.message;
	} catch {
		/* not JSON — fall through to the status message */
	}
	throw new Error(message || `Request failed (${response.status})`);
}

export async function postAnnotation(
	fetchFn: typeof fetch,
	fact: FactKey,
	annotation: AnnotationInput
): Promise<SavedAnnotation> {
	const response = await send(fetchFn, 'POST', { fact, annotation });
	const data = (await response.json()) as SavedAnnotation;
	return { iri: data.iri, annotatedBy: data.annotatedBy, annotatedAt: data.annotatedAt };
}

export async function deleteAnnotationRequest(fetchFn: typeof fetch, iri: string): Promise<void> {
	await send(fetchFn, 'DELETE', { iri });
}
