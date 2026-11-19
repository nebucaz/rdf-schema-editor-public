import { describe, expect, it, vi } from 'vitest';
import { loadOpenChangeRequests, loadRecentChanges, loadVocabularyExtras } from './ontology-dashboard-data.js';

describe('loadVocabularyExtras (STORY-473)', () => {
	it('reads governance, collections and schemes of the core namespace in parallel', async () => {
		const connector = {
			fetchVocabularyNamespace: vi.fn(async () => 'urn:core'),
			fetchNamespaceGovernance: vi.fn(async () => ({ steward: 'sam', authority: '', maturity: 'pilot' as const, version: '1.0.0' })),
			fetchCollections: vi.fn(async () => []),
			fetchConceptSchemes: vi.fn(async () => [{ iri: 'urn:s' }])
		};
		const extras = await loadVocabularyExtras(connector as never);
		expect(extras.governance).toEqual({ namespaceIri: 'urn:core', steward: 'sam', authority: '', maturity: 'pilot', version: '1.0.0' });
		expect(extras.schemes).toEqual([{ iri: 'urn:s' }]);
		expect(connector.fetchVocabularyNamespace).toHaveBeenCalledTimes(1);
	});

	it('is empty without a core namespace and sends no further request', async () => {
		const connector = { fetchVocabularyNamespace: vi.fn(async () => null), fetchNamespaceGovernance: vi.fn(), fetchCollections: vi.fn(), fetchConceptSchemes: vi.fn() };
		expect(await loadVocabularyExtras(connector as never)).toEqual({ governance: null, collections: [], schemes: [] });
		expect(connector.fetchNamespaceGovernance).not.toHaveBeenCalled();
	});

	it('rejects when a read fails, so the caller can show a local notice', async () => {
		const connector = { fetchVocabularyNamespace: vi.fn(async () => { throw new Error('down'); }) };
		await expect(loadVocabularyExtras(connector as never)).rejects.toThrow('down');
	});
});

describe('loadOpenChangeRequests (STORY-473)', () => {
	it('counts the requests that can still be decided', async () => {
		const connector = { fetchChangeRequests: vi.fn(async () => [{ status: 'open' }, { status: 'in-review' }, { status: 'approved' }, { status: 'rejected' }]) };
		expect(await loadOpenChangeRequests(connector as never)).toBe(2);
	});
});

describe('loadRecentChanges (STORY-473)', () => {
	const entry = (n: number) => ({ iri: `urn:e${n}`, kind: 'change', summary: `s${n}`, rationale: '', term: '', question: '', changeKind: '', version: '1.0.0', changedBy: 'a', changedAt: `2026-01-0${n}T00:00:00Z` });

	it('keeps the five newest entries of the newest-first list', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ entries: [1, 2, 3, 4, 5, 6, 7].map(entry) }), { status: 200 }));
		const entries = await loadRecentChanges(fetchFn as unknown as typeof fetch);
		expect(entries.map((e) => e.iri)).toEqual(['urn:e1', 'urn:e2', 'urn:e3', 'urn:e4', 'urn:e5']);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('rejects with the server message on failure', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 502 }));
		await expect(loadRecentChanges(fetchFn as unknown as typeof fetch)).rejects.toThrow('nope');
	});
});
