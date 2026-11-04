import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureLoaded, refresh } = vi.hoisted(() => ({ ensureLoaded: vi.fn(), refresh: vi.fn() }));
vi.mock('#lib/stores/schema-store.js', () => ({ schemaStore: { ensureLoaded, refresh } }));

import { QueryBuilderStore } from './query-builder-store.svelte';
import { startQueryFromClass } from '#lib/services/query-model-edit.js';
import type { BrowserPick } from '#lib/services/query-object-browser.js';

const NS = 'http://example.org/org';
const o = (n: string) => `${NS}#${n}`;
const step = (rel: string, target: string) => ({
	relationshipIri: o(rel),
	direction: 'forward' as const,
	targetClassIri: o(target)
});

describe('QueryBuilderStore.applyBrowserSelection', () => {
	it('starts a query from a start-class pick, with the scope as namespaces', () => {
		const store = new QueryBuilderStore();
		const pick: BrowserPick = {
			path: { anchor: { startClassIri: o('Org') }, steps: [step('hasTeam', 'Team')] },
			source: 'label',
			header: 'Team'
		};
		expect(store.applyBrowserSelection([pick], [], [NS])).toBe(true);
		expect(store.model!.root.classIri).toBe(o('Org'));
		expect(store.model!.namespaces).toEqual([NS]);
		expect(store.model!.hops).toHaveLength(1);
		expect(store.model!.columns).toHaveLength(1);
	});

	it('extends and edits the current query in one assignment', () => {
		const store = new QueryBuilderStore();
		store.load({ ...startQueryFromClass(o('Org'), [NS]), columns: [{ id: 'c1', hopId: null, source: 'label', header: 'O' }] });
		const pick: BrowserPick = { path: { anchor: { hopId: null }, steps: [step('hasTeam', 'Team')] }, source: 'iri', header: 'T' };
		expect(store.applyBrowserSelection([pick], ['c1'], [NS])).toBe(true);
		expect(store.model!.columns.map((c) => c.id === 'c1')).toEqual([false]);
		expect(store.model!.hops).toHaveLength(1);
	});

	it('leaves the model untouched and reports false when a path is rejected', () => {
		const store = new QueryBuilderStore();
		const before = startQueryFromClass(o('Org'), [NS]);
		store.load(before);
		const loop = ['hasTeam', 'hasMember', 'owns', 'hasTeam'].map((r) => step(r, r === 'owns' ? 'Org' : 'Team'));
		const pick: BrowserPick = { path: { anchor: { hopId: null }, steps: loop }, source: 'label', header: 'x' };
		const snapshot = JSON.stringify(store.model);
		expect(store.applyBrowserSelection([pick], [], [NS])).toBe(false);
		expect(JSON.stringify(store.model)).toBe(snapshot);
	});
});

describe('QueryBuilderStore.loadSchema (reduce-requests STORY-301)', () => {
	const emptySchema = {
		classes: [],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	};

	beforeEach(() => {
		ensureLoaded.mockReset().mockResolvedValue(emptySchema);
		refresh.mockReset().mockResolvedValue(emptySchema);
	});

	it('takes the full schema (the builder lists individuals) from the shared store', async () => {
		const store = new QueryBuilderStore();
		await store.loadSchema();
		expect(ensureLoaded).toHaveBeenCalledWith('full');
		expect(refresh).not.toHaveBeenCalled();
		expect(store.schema).not.toBeNull();
		expect(store.schemaError).toBeNull();
	});

	it('refetches through the store when asked to, e.g. on every workbench visit', async () => {
		const store = new QueryBuilderStore();
		await store.loadSchema({ force: true });
		expect(refresh).toHaveBeenCalledWith('full');
		expect(ensureLoaded).not.toHaveBeenCalled();
		expect(store.schema).not.toBeNull();
	});

	it('reports a load error and clears the loading flag', async () => {
		ensureLoaded.mockRejectedValue(new Error('boom'));
		const store = new QueryBuilderStore();
		await store.loadSchema();
		expect(store.schemaError).toBe('boom');
		expect(store.schemaLoading).toBe(false);
	});
});
