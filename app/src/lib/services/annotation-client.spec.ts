import { describe, it, expect, vi } from 'vitest';
import { postAnnotation, deleteAnnotationRequest } from './annotation-client';
import type { FactKey } from './sparql-connector';

const fact: FactKey = {
	subjectIri: 'http://x#a',
	predicateIri: 'http://x#p',
	object: { kind: 'literal', value: 'v' }
};
const res = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('postAnnotation', () => {
	it('posts the fact and annotation and never sends an author or timestamp', async () => {
		const fetchFn = vi.fn(async () =>
			res(200, { iri: 'http://x#ann', annotatedBy: 'u-1', annotatedAt: '2026-03-01T10:00:00Z' })
		);
		const saved = await postAnnotation(fetchFn as unknown as typeof fetch, fact, { type: 'text', text: 'hi' });
		expect(saved).toEqual({ iri: 'http://x#ann', annotatedBy: 'u-1', annotatedAt: '2026-03-01T10:00:00Z' });
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/annotations');
		expect(init.method).toBe('POST');
		const body = JSON.parse(String(init.body));
		expect(body).toEqual({ fact, annotation: { type: 'text', text: 'hi' } });
		expect(JSON.stringify(body)).not.toMatch(/annotatedBy|annotatedAt/);
	});

	it('surfaces the server message for 401 and validation errors', async () => {
		const unauth = async () => res(401, { message: 'Annotating requires a signed-in user' });
		await expect(postAnnotation(unauth as unknown as typeof fetch, fact, { type: 'text', text: 'x' }))
			.rejects.toThrow('Annotating requires a signed-in user');
		const bad = async () => res(400, { message: 'Annotation text must not be empty' });
		await expect(postAnnotation(bad as unknown as typeof fetch, fact, { type: 'text', text: ' ' }))
			.rejects.toThrow('Annotation text must not be empty');
	});

	it('falls back to a status message when the body is not JSON', async () => {
		const broken = async () => new Response('<html>', { status: 502 });
		await expect(postAnnotation(broken as unknown as typeof fetch, fact, { type: 'text', text: 'x' }))
			.rejects.toThrow(/502/);
	});

	it('turns a network failure into a readable error', async () => {
		const offline = async () => { throw new TypeError('Failed to fetch'); };
		await expect(postAnnotation(offline as unknown as typeof fetch, fact, { type: 'text', text: 'x' }))
			.rejects.toThrow(/network/i);
	});
});

describe('deleteAnnotationRequest', () => {
	it('sends DELETE with the annotation iri', async () => {
		const fetchFn = vi.fn(async () => res(200, { success: true }));
		await deleteAnnotationRequest(fetchFn as unknown as typeof fetch, 'http://x#ann');
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/annotations');
		expect(init.method).toBe('DELETE');
		expect(JSON.parse(String(init.body))).toEqual({ iri: 'http://x#ann' });
	});

	it('throws the server message on failure', async () => {
		const f = async () => res(401, { message: 'Annotating requires a signed-in user' });
		await expect(deleteAnnotationRequest(f as unknown as typeof fetch, 'http://x#ann'))
			.rejects.toThrow('signed-in');
	});
});
