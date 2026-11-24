import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const connector = vi.hoisted(() => ({
	fetchScopedTurtlePair: vi.fn(),
	fetchScopedTurtleForWorkspace: vi.fn(),
	fetchVocabTurtle: vi.fn(async () => '<c> a skos:Concept .'),
	fetchCatalogTurtleForClass: vi.fn(async () => ''),
	saveScopedTurtle: vi.fn(async () => undefined)
}));
vi.mock('#lib/services/sparql-connector.js', () => ({ sparqlConnector: connector }));

import TriplesPanel from './TriplesPanel.svelte';
import type { FetchedNamespace } from '#lib/services/sparql-connector.js';

const NS = 'http://example.org/ns';
const pair = (over: Record<string, unknown> = {}) => ({
	schema: '<a> a owl:Class .',
	instances: '<i> a <a> .',
	shapes: '<s> a sh:NodeShape .',
	instancesTripleCount: 1,
	...over
});

function mount(props: Record<string, unknown> = {}) {
	return render(TriplesPanel, {
		props: {
			scope: { kind: 'all' },
			namespaces: [{ baseIri: NS, prefix: 'ex' } as FetchedNamespace],
			initialNamespaceBaseIri: NS,
			showCatalogTab: false,
			onClose: () => {},
			onSaved: () => {},
			...props
		}
	});
}

describe('TriplesPanel tabs (triples-tabs STORY-601)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		connector.fetchScopedTurtlePair.mockResolvedValue(pair());
	});

	it('shows Schema, Instances and Shapes tabs', async () => {
		mount();
		await screen.findByRole('tab', { name: 'Instances' });
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Schema', 'Instances', 'Shapes']);
	});

	it('saves the Instances tab with the instances partition', async () => {
		mount();
		await fireEvent.click(await screen.findByRole('tab', { name: 'Instances' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(connector.saveScopedTurtle).toHaveBeenCalled());
		expect(connector.saveScopedTurtle).toHaveBeenCalledWith(null, '<i> a <a> .', 'instances', NS);
	});

	it('is read-only above the row cap and says why', async () => {
		connector.fetchScopedTurtlePair.mockResolvedValue(pair({ instancesTripleCount: 5001 }));
		mount();
		await fireEvent.click(await screen.findByRole('tab', { name: 'Instances' }));
		expect(screen.getByRole('note').textContent).toContain('read-only');
		expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
		expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
	});

	it('opens an individual node on its Instances tab', async () => {
		connector.fetchScopedTurtlePair.mockResolvedValue(pair({ schema: '' }));
		mount({ scope: { kind: 'node', iri: `${NS}#alice`, namespaceBaseIri: NS } });
		await waitFor(() =>
			expect(screen.getByRole('tab', { name: 'Instances' }).getAttribute('aria-selected')).toBe('true')
		);
	});

	it('keeps a class node on its Schema tab', async () => {
		mount({ scope: { kind: 'node', iri: `${NS}#Person`, namespaceBaseIri: NS } });
		await screen.findByRole('tab', { name: 'Schema' });
		await waitFor(() => expect(connector.fetchScopedTurtlePair).toHaveBeenCalled());
		expect(screen.getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected')).toBe('true');
	});

	describe('Vocab tab (STORY-602)', () => {
		const ns = (vocabulary: boolean) => [
			{ baseIri: NS, prefix: 'ex', vocabulary } as FetchedNamespace,
			{ baseIri: `${NS}2`, prefix: 'o', vocabulary: false } as FetchedNamespace
		];

		it('is shown for the vocabulary namespace only, and is read-only', async () => {
			mount({ namespaces: ns(true) });
			await fireEvent.click(await screen.findByRole('tab', { name: 'Vocab' }));
			await screen.findByDisplayValue('<c> a skos:Concept .');
			expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
			expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
			expect(screen.getByRole('button', { name: 'Download .ttl' })).toBeTruthy();
			expect(connector.fetchVocabTurtle).toHaveBeenCalledWith(NS);
		});

		it('is absent when no namespace is flagged', async () => {
			mount({ namespaces: ns(false) });
			await screen.findByRole('tab', { name: 'Shapes' });
			expect(screen.queryByRole('tab', { name: 'Vocab' })).toBeNull();
			expect(connector.fetchVocabTurtle).not.toHaveBeenCalled();
		});

		it('is absent for a namespace that is not the vocabulary one', async () => {
			mount({ namespaces: ns(true), initialNamespaceBaseIri: `${NS}2` });
			await screen.findByRole('tab', { name: 'Shapes' });
			expect(screen.queryByRole('tab', { name: 'Vocab' })).toBeNull();
		});
	});
});
