import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import VocabularyConceptsTab from './VocabularyConceptsTab.svelte';
import { DEFAULT_LIST_STATE, type ListUrlState } from '#lib/services/list-url-state.js';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (iri: string, label: string, schemeIri = 'urn:s1'): Concept => ({
	iri, prefLabels: [{ text: label, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri, topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '',
	created: '', modified: '', deprecatedOn: ''
});
const scope = { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' };
const schemes = [
	{ iri: 'urn:s1', name: 'Glossary', description: '', scope },
	{ iri: 'http://x/vocab#Products', name: '', description: '', scope }
];

function setup(over: { state?: Partial<ListUrlState>; total?: number } = {}) {
	const connector = {
		fetchConcepts: vi.fn(async () => ({ concepts: [concept('urn:1', 'Customer'), concept('urn:2', 'Invoice', 'http://x/vocab#Products')], hasMore: false })),
		countConcepts: vi.fn(async () => over.total ?? 60),
		countConceptsByScheme: vi.fn(async () => ({ 'urn:s1': 40, 'http://x/vocab#Products': 20 }))
	};
	const props = {
		core: 'http://x/core',
		connector,
		schemes,
		findings: [],
		selectedIri: null,
		reloadKey: 0,
		listState: { ...DEFAULT_LIST_STATE, ...over.state },
		onStateChange: vi.fn(),
		onSelect: vi.fn(),
		onAdd: vi.fn(),
		onBackfill: vi.fn()
	};
	render(VocabularyConceptsTab, { props });
	return { connector, props };
}

describe('VocabularyConceptsTab (STORY-448)', () => {
	beforeEach(() => vi.useRealTimers());
	afterEach(() => vi.useRealTimers());

	it('loads one server page of 25 with the count and shows rows with their scheme names', async () => {
		const { connector } = setup();
		await waitFor(() => expect(screen.getByRole('button', { name: /^Customer/ })).toBeInTheDocument());
		expect(connector.fetchConcepts).toHaveBeenCalledWith('http://x/core', { limit: 25, offset: 0, search: '', status: undefined, schemeIri: undefined });
		expect(connector.countConcepts).toHaveBeenCalledWith('http://x/core', { search: '', status: undefined, schemeIri: undefined });
		expect(screen.getByRole('button', { name: /^Invoice.*Products$/ })).toBeInTheDocument();
		expect(screen.getByText('60 results')).toBeInTheDocument();
	});

	it('asks for the right offset on page 3 and passes search, status and scheme to the server', async () => {
		const { connector } = setup({ state: { page: 3, q: 'bank', status: 'approved', scheme: 'urn:s1' } });
		await waitFor(() => expect(connector.fetchConcepts).toHaveBeenCalled());
		expect(connector.fetchConcepts).toHaveBeenCalledWith('http://x/core', { limit: 25, offset: 50, search: 'bank', status: 'approved', schemeIri: 'urn:s1' });
		expect(connector.countConcepts).toHaveBeenCalledWith('http://x/core', { search: 'bank', status: 'approved', schemeIri: 'urn:s1' });
	});

	it('has Add concept and Create concepts for unlinked classes in the toolbar above the list', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByTestId('add-concept'));
		await fireEvent.click(screen.getByTestId('backfill-concepts'));
		expect(props.onAdd).toHaveBeenCalled();
		expect(props.onBackfill).toHaveBeenCalled();
		await waitFor(() => screen.getByRole('button', { name: /^Customer/ }));
		const add = screen.getByTestId('add-concept');
		expect(add.compareDocumentPosition(screen.getByRole('button', { name: /^Customer/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('lists each scheme with its concept count in the Scheme filter, using the fallback name', async () => {
		setup();
		await waitFor(() => expect(screen.getByRole('option', { name: 'Glossary (40)' })).toBeInTheDocument());
		expect(screen.getByRole('option', { name: 'Products (20)' })).toBeInTheDocument();
	});

	it('reports a changed filter with the page reset to 1', async () => {
		const { props } = setup({ state: { page: 4 }, total: 200 });
		await fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'proposed' } });
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, page: 1, status: 'proposed' });
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: 'http://x/vocab#Products' } });
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, page: 1, scheme: 'http://x/vocab#Products' });
	});

	it('reports a new search from page 4 as page 1', async () => {
		vi.useFakeTimers();
		const { props } = setup({ state: { page: 4 }, total: 200 });
		await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'bank' } });
		vi.advanceTimersByTime(300);
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, q: 'bank', page: 1 });
	});

	it('selects a concept on click', async () => {
		const { props } = setup();
		await waitFor(() => screen.getByRole('button', { name: /^Customer/ }));
		await fireEvent.click(screen.getByRole('button', { name: /^Customer/ }));
		expect(props.onSelect).toHaveBeenCalledWith('urn:1');
	});

	it('says there are no concepts yet for an empty vocabulary', async () => {
		setup({ total: 0 });
		await waitFor(() => expect(screen.getByText('No results')).toBeInTheDocument());
	});
});
