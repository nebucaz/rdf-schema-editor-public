import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import VocabularySchemesTab from './VocabularySchemesTab.svelte';
import { DEFAULT_LIST_STATE, type ListUrlState } from '#lib/services/list-url-state.js';
import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';

const scope = { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' };
const CORE = 'http://x/core';
const scheme = (iri: string, name: string): ConceptScheme => ({
	iri, name, description: '', scope, metadata: { title: '', creator: '', publisher: '', rights: '', modified: '2026-11-01T10:00:00Z' }
});
const concept = (iri: string, schemeIri: string, over: Partial<Concept> = {}): Concept => ({
	iri, prefLabels: [{ text: iri, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri, topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '',
	created: '', modified: '', deprecatedOn: '', broader: [], related: [], mappings: [], ...over
});

const schemes = [scheme(`${CORE}/vocab#Glossary`, 'Glossary'), scheme(`${CORE}/vocab#Products`, '')];
const concepts = [
	concept('urn:1', schemes[0].iri, { topConcept: true }),
	concept('urn:2', schemes[0].iri),
	concept('urn:3', schemes[1].iri, { topConcept: true })
];

function setup(over: { state?: Partial<ListUrlState> } = {}) {
	const props = {
		core: CORE,
		schemes,
		concepts,
		listState: { ...DEFAULT_LIST_STATE, tab: 'schemes' as const, ...over.state },
		onStateChange: vi.fn(),
		onAdd: vi.fn(async (_draft: { name: string; description: string }) => schemes[0].iri),
		onSaveScope: vi.fn(async () => {}),
		onSaveMetadata: vi.fn(async () => {}),
		onDelete: vi.fn(async (_iri: string, _force: boolean) => ({ deleted: true, concepts: [] as string[], linkedClasses: [] as string[], conceptProperties: [] as string[], collections: [] as string[] }))
	};
	render(VocabularySchemesTab, { props });
	return props;
}

describe('VocabularySchemesTab (STORY-449)', () => {
	it('lists every scheme with its counts, falling back to the local name', () => {
		setup();
		const rows = screen.getAllByRole('row').slice(1).map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
		expect(rows[0]).toContain('Glossary');
		expect(rows[0]).toMatch(/Glossary\s*2\s*1\s*1/);
		expect(rows[1]).toContain('Products');
		expect(screen.getByText('2 results')).toBeInTheDocument();
	});

	it('searches by name and tells the page the state changed', async () => {
		vi.useFakeTimers();
		const props = setup();
		await fireEvent.input(screen.getByRole('searchbox', { name: 'Search Schemes' }), { target: { value: 'prod' } });
		vi.advanceTimersByTime(300);
		vi.useRealTimers();
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, tab: 'schemes', q: 'prod', page: 1 });
	});

	it('filters the rows by the q of the state', () => {
		setup({ state: { q: 'prod' } });
		expect(screen.getByText('1 result')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /Glossary/ })).toBeNull();
	});

	it('Add scheme sits in the toolbar, creates the scheme and selects it', async () => {
		const props = setup();
		expect(screen.queryByLabelText('Name')).toBeNull();
		await fireEvent.click(screen.getByTestId('add-scheme'));
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Lifecycle' } });
		await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Stages' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Create scheme' }));
		expect(props.onAdd).toHaveBeenCalledWith({ name: 'Lifecycle', description: 'Stages' });
		await waitFor(() => expect(screen.getByRole('heading', { name: 'Glossary' })).toBeInTheDocument());
	});

	it('refuses an empty name', async () => {
		setup();
		await fireEvent.click(screen.getByTestId('add-scheme'));
		expect(screen.getByRole('button', { name: 'Create scheme' })).toBeDisabled();
	});

	it('shows the scope form and the three actions for the selected scheme', async () => {
		const props = setup();
		await fireEvent.click(screen.getByRole('button', { name: /^Glossary/ }));
		expect(screen.getByRole('heading', { name: 'Glossary' })).toBeInTheDocument();
		expect(screen.getByTestId('scheme-review-link').getAttribute('href')).toContain('/review/scheme?scheme=');
		expect(screen.getByTestId('scheme-taxonomy-link').getAttribute('href')).toBe(`/taxonomy?scheme=${encodeURIComponent(schemes[0].iri)}`);
		await fireEvent.click(screen.getByTestId('scheme-open-concepts'));
		expect(props.onStateChange).toHaveBeenLastCalledWith({ ...DEFAULT_LIST_STATE, tab: 'concepts', scheme: schemes[0].iri, page: 1 });
	});

	it('has no New scheme field or Scope of drop-down any more', () => {
		setup();
		expect(screen.queryByLabelText('New scheme')).toBeNull();
		expect(screen.queryByLabelText('Scope of')).toBeNull();
	});

	it('explains the empty state', () => {
		render(VocabularySchemesTab, {
			props: { core: CORE, schemes: [], concepts: [], listState: { ...DEFAULT_LIST_STATE, tab: 'schemes' }, onStateChange: () => {}, onAdd: async () => '', onSaveScope: async () => {}, onSaveMetadata: async () => {}, onDelete: async () => ({ deleted: true, concepts: [], linkedClasses: [], conceptProperties: [], collections: [] }) }
		});
		expect(screen.getByText('No results')).toBeInTheDocument();
		expect(screen.getByText(/A scheme groups concepts/)).toBeInTheDocument();
	});

	describe('Delete scheme', () => {
		const blocked = { deleted: false, concepts: ['urn:1', 'urn:2'], linkedClasses: ['urn:cls'], conceptProperties: [], collections: ['urn:col'] };

		it('deletes at once when nothing blocks it', async () => {
			const props = setup();
			await fireEvent.click(screen.getByText('Glossary'));
			await fireEvent.click(screen.getByTestId('scheme-delete'));
			expect(props.onDelete).toHaveBeenCalledWith(schemes[0].iri, false);
			expect(screen.queryByTestId('scheme-delete-confirm')).toBeNull();
		});

		it('asks first when the scheme has concepts, says what goes, and only then deletes with force', async () => {
			const props = setup();
			props.onDelete.mockResolvedValueOnce(blocked).mockResolvedValueOnce({ ...blocked, deleted: true });
			await fireEvent.click(screen.getByText('Glossary'));
			await fireEvent.click(screen.getByTestId('scheme-delete'));
			const confirm = await screen.findByTestId('scheme-delete-confirm');
			expect(confirm.textContent).toContain('Delete scheme and 2 concepts');
			expect(screen.getByText(/1 class link to these concepts/)).toBeInTheDocument();
			expect(screen.getByText(/1 collection lose these concepts/)).toBeInTheDocument();
			expect(props.onDelete).toHaveBeenCalledTimes(1);
			await fireEvent.click(confirm);
			expect(props.onDelete).toHaveBeenLastCalledWith(schemes[0].iri, true);
			await waitFor(() => expect(screen.queryByTestId('scheme-delete-confirm')).toBeNull());
		});

		it('keeps everything when the dialog is cancelled', async () => {
			const props = setup();
			props.onDelete.mockResolvedValueOnce(blocked);
			await fireEvent.click(screen.getByText('Glossary'));
			await fireEvent.click(screen.getByTestId('scheme-delete'));
			await fireEvent.click(await screen.findByText('Cancel'));
			expect(props.onDelete).toHaveBeenCalledTimes(1);
		});

		it('shows a failure beside the button', async () => {
			const props = setup();
			props.onDelete.mockRejectedValueOnce(new Error('Scheme not found'));
			await fireEvent.click(screen.getByText('Glossary'));
			await fireEvent.click(screen.getByTestId('scheme-delete'));
			expect(await screen.findByRole('alert')).toHaveTextContent('Scheme not found');
		});
	});
});
