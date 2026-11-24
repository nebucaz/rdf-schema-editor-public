import { describe, it, expect, vi, beforeEach } from 'vitest';

const refresh = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('./schema-store.js', () => ({ schemaStore: { refresh } }));

import { triplesPanel } from './triples-panel-store.svelte.js';

describe('triplesPanel store (triples-tabs STORY-603)', () => {
	beforeEach(() => {
		triplesPanel.close();
		triplesPanel.registerOnSaved(null);
		vi.clearAllMocks();
	});

	it('opens with a request and closes', () => {
		expect(triplesPanel.open).toBe(false);
		triplesPanel.show({ scope: { kind: 'all' }, initialTab: 'instances' });
		expect(triplesPanel.open).toBe(true);
		expect(triplesPanel.request.initialTab).toBe('instances');
		triplesPanel.close();
		expect(triplesPanel.open).toBe(false);
	});

	it('toggle opens with the given defaults and closes when open', () => {
		triplesPanel.toggle({ scope: { kind: 'all' }, initialTab: 'shapes' });
		expect(triplesPanel.open).toBe(true);
		expect(triplesPanel.request.initialTab).toBe('shapes');
		triplesPanel.toggle({ scope: { kind: 'all' }, initialTab: 'schema' });
		expect(triplesPanel.open).toBe(false);
	});

	it('a new request while open replaces the old one', () => {
		triplesPanel.show({ scope: { kind: 'all' }, initialTab: 'schema' });
		triplesPanel.show({ scope: { kind: 'node', iri: 'x', namespaceBaseIri: 'n' }, initialTab: 'catalog' });
		expect(triplesPanel.request.scope.kind).toBe('node');
	});

	it('saved calls the registered page handler, else refreshes the shared schema', async () => {
		await triplesPanel.notifySaved();
		expect(refresh).toHaveBeenCalledTimes(1);
		const handler = vi.fn();
		triplesPanel.registerOnSaved(handler);
		await triplesPanel.notifySaved();
		expect(handler).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});
