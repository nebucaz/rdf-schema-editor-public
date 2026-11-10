import { describe, expect, it, vi } from 'vitest';
import { fetchChangeLog, postChangeLogEntry } from './changelog-client';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('changelog client (STORY-331)', () => {
	it('posts the entry without an author or time', async () => {
		const fetchFn = vi.fn(async () => ok({ iri: 'urn:e', changedBy: 'alice', changedAt: 't' }));
		const saved = await postChangeLogEntry(fetchFn as never, { kind: 'change', summary: 's', changedBy: 'mallory' } as never);
		expect(saved).toEqual({ iri: 'urn:e', changedBy: 'alice', changedAt: 't' });
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toMatch(/\/changelog$/);
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ kind: 'change', summary: 's' });
	});

	it('lists with the filters as query parameters, leaving empty ones out', async () => {
		const fetchFn = vi.fn(async () => ok({ entries: [{ iri: 'urn:e', summary: 's' }] }));
		const entries = await fetchChangeLog(fetchFn as never, { term: 'urn:t', question: '', version: '1.0.0' });
		expect(entries).toHaveLength(1);
		const url = (fetchFn.mock.calls[0] as unknown as [string])[0];
		expect(url).toContain('term=urn%3At');
		expect(url).toContain('version=1.0.0');
		expect(url).not.toContain('question');
	});

	it('reports the server message on failure', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: 'A summary is required' }), { status: 400 }));
		await expect(postChangeLogEntry(fetchFn as never, { kind: 'change', summary: '' })).rejects.toThrow('A summary is required');
	});
});
