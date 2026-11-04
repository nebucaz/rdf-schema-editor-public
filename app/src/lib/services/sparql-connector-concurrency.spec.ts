import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestActivity } from '#lib/stores/request-activity.svelte.js';
import { MAX_CONCURRENT_SPARQL_REQUESTS, SparqlConnector } from './sparql-connector';

/** reduce-requests STORY-299: however many requests the app queues, only a few reach GraphDB at once. */
describe('SparqlConnector concurrency limit', () => {
	let inFlight = 0;
	let peak = 0;
	let release: (() => void)[] = [];

	beforeEach(() => {
		inFlight = 0;
		peak = 0;
		release = [];
		requestActivity.reset();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise<Response>((resolve) => {
						inFlight++;
						peak = Math.max(peak, inFlight);
						release.push(() => {
							inFlight--;
							resolve(new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 }));
						});
					})
			)
		);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		requestActivity.reset();
	});

	const tick = () => new Promise((r) => setTimeout(r, 0));

	it('has a limit of 6', () => {
		expect(MAX_CONCURRENT_SPARQL_REQUESTS).toBe(6);
	});

	it('lets at most the limit through at once, for queries and updates together', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const calls = [
			...Array.from({ length: 15 }, () => connector.selectQuery('SELECT * WHERE {}')),
			...Array.from({ length: 5 }, () => connector.executeUpdate('INSERT DATA {}'))
		];
		await tick();
		expect(inFlight).toBe(MAX_CONCURRENT_SPARQL_REQUESTS);
		// Drain: release whatever is running until every call has settled.
		while (release.length > 0) {
			release.shift()!();
			await tick();
		}
		await Promise.all(calls);
		expect(peak).toBe(MAX_CONCURRENT_SPARQL_REQUESTS);
	});

	it('counts queued requests as pending, so the activity indicator stays accurate', async () => {
		const connector = new SparqlConnector('/api/sparql');
		const calls = Array.from({ length: 10 }, () => connector.selectQuery('SELECT * WHERE {}'));
		await tick();
		expect(requestActivity.pending).toBe(10);
		expect(inFlight).toBe(MAX_CONCURRENT_SPARQL_REQUESTS);
		while (release.length > 0) {
			release.shift()!();
			await tick();
		}
		await Promise.all(calls);
		expect(requestActivity.pending).toBe(0);
	});

	it('still lets a request through after one failed', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(
			new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 })
		));
		const connector = new SparqlConnector('/api/sparql');
		await expect(connector.selectQuery('SELECT * WHERE {}')).rejects.toThrow('network');
		await expect(connector.selectQuery('SELECT * WHERE {}')).resolves.toBeDefined();
	});
});
