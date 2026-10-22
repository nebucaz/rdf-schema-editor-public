import { describe, expect, it } from 'vitest';
import { QueryBuilderStore } from './query-builder-store.svelte';
import { startQueryFromClass } from '$lib/services/query-model-edit';
import type { BrowserPick } from '$lib/services/query-object-browser';

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
