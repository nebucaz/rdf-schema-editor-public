import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestActivity } from '#lib/stores/request-activity.svelte.js';
import { SparqlConnector } from './sparql-connector';

/** misc-issues STORY-306: a connector request started inside an `$effect` must not re-run that effect.
 *  Every screen that loads data from an effect (TriplesPanel, Manage instances, the stores) relies on it. */
describe('SparqlConnector request started inside an $effect', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		requestActivity.reset();
		fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		requestActivity.reset();
	});

	it('sends the request once and does not re-run the effect when it settles', async () => {
		const connector = new SparqlConnector('/api/sparql');
		let runs = 0;
		const dispose = $effect.root(() => {
			$effect(() => {
				runs++;
				void connector.selectQuery('SELECT ?s WHERE { ?s ?p ?o }');
			});
		});
		flushSync();
		await new Promise((r) => setTimeout(r, 10));
		flushSync();
		expect(runs).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(requestActivity.pending).toBe(0);
		dispose();
	});
});
