import { describe, expect, it, vi } from 'vitest';
import { createConceptStore } from './concept-store.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (iri: string): Concept => ({
	iri,
	prefLabels: [{ text: iri, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: ''
});

describe('conceptStore (STORY-325)', () => {
	it('loads once and reuses the result while nothing was written', async () => {
		const load = vi.fn(async () => [concept('urn:1')]);
		const store = createConceptStore({ load, writeCount: () => 0 });
		expect(await store.ensureLoaded()).toHaveLength(1);
		expect(await store.ensureLoaded()).toHaveLength(1);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('reloads after a write', async () => {
		let writes = 0;
		const load = vi.fn(async () => [concept('urn:1')]);
		const store = createConceptStore({ load, writeCount: () => writes });
		await store.ensureLoaded();
		writes = 1;
		await store.ensureLoaded();
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('reports no vocabulary as an empty list', async () => {
		const store = createConceptStore({ load: async () => null, writeCount: () => 0 });
		expect(await store.ensureLoaded()).toEqual([]);
	});

	it('does not remember a failed load', async () => {
		const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([concept('urn:1')]);
		const store = createConceptStore({ load, writeCount: () => 0 });
		await expect(store.ensureLoaded()).rejects.toThrow('down');
		expect(await store.ensureLoaded()).toHaveLength(1);
	});

	it('refresh forces a new load', async () => {
		const load = vi.fn(async () => [concept('urn:1')]);
		const store = createConceptStore({ load, writeCount: () => 0 });
		await store.ensureLoaded();
		await store.refresh();
		expect(load).toHaveBeenCalledTimes(2);
	});
});
