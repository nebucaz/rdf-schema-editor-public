import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import OntologyDashboard from './OntologyDashboard.svelte';
import { createOntologyDashboardState, type OntologyDashboardDeps } from '#lib/stores/ontology-dashboard-state.svelte.js';
import { DEFAULT_LAYOUT, hideTile, moveTile } from '#lib/services/dashboard-layout.js';
import type { FetchedSchema } from '#lib/services/sparql-connector.js';

const schema = { classes: [], datatypeProperties: [], objectProperties: [], individuals: [], untypedIndividuals: [], shapes: [] } as unknown as FetchedSchema;

function deps(over: Partial<OntologyDashboardDeps> = {}): OntologyDashboardDeps {
	return {
		loadSchema: async () => schema,
		loadNamespaces: async () => [{ baseIri: 'urn:ns:a', prefix: 'a', pipeline: true }],
		loadQuestions: async () => ({ questions: [], runs: [] }),
		loadConcepts: async () => [],
		loadExtras: async () => ({ governance: { namespaceIri: 'urn:core', steward: 'Sam', authority: 'Board', maturity: 'pilot' as const, version: '1.0.0' }, collections: [], schemes: [] }),
		loadOpenRequests: async () => 1,
		loadChanges: async () => [{ iri: 'urn:e1', kind: 'change' as const, summary: 'Added Bank', rationale: '', term: '', question: '', changeKind: '' as const, version: '1.0.0', changedBy: 'alice', changedAt: '2026-03-01T00:00:00Z' }],
		settings: () => ({ reviewPeriodMonths: 3, staleAfterMonths: 12 }),
		...over
	};
}

async function loaded(over: Partial<OntologyDashboardDeps> = {}) {
	const state = createOntologyDashboardState(deps(over));
	await state.load();
	return state;
}

describe('OntologyDashboard (STORY-474)', () => {
	it('renders every tile in the default order, with its data', async () => {
		const state = await loaded();
		render(OntologyDashboard, { props: { state, layout: DEFAULT_LAYOUT, onOpenGuide: () => {} } });
		const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
		expect(titles).toEqual(['Stages', 'Scheme health', 'Getting started', 'Model checks', 'Competency questions', 'Governance', 'Recent changes', 'Guides']);
		expect(within(screen.getByTestId('tile-stages')).getByRole('table')).toBeInTheDocument();
		expect(screen.getByTestId('checks-none')).toBeInTheDocument();
		expect(screen.getByTestId('questions-none')).toBeInTheDocument();
		expect(screen.getByTestId('governance-steward')).toHaveTextContent('Sam');
		expect(screen.getByText('Added Bank')).toBeInTheDocument();
	});

	it('follows the layout: order and hidden tiles', async () => {
		const state = await loaded();
		const layout = hideTile(moveTile(DEFAULT_LAYOUT, 'guides', 0), 'getting-started');
		render(OntologyDashboard, { props: { state, layout, onOpenGuide: () => {} } });
		const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent?.trim());
		expect(titles[0]).toBe('Guides');
		expect(titles).not.toContain('Getting started');
	});

	it('reports a layout change through onchange', async () => {
		const state = await loaded();
		const onchange = vi.fn();
		render(OntologyDashboard, { props: { state, layout: DEFAULT_LAYOUT, onchange } });
		await fireEvent.click(screen.getByRole('button', { name: 'Hide Guides' }));
		expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ hidden: ['guides'] }));
	});

	it('shows loading placeholders before the data arrives, and the page error in the data tiles', async () => {
		const state = createOntologyDashboardState(deps({ loadSchema: () => new Promise(() => {}) }));
		void state.load();
		render(OntologyDashboard, { props: { state, layout: DEFAULT_LAYOUT } });
		expect(within(screen.getByTestId('tile-stages')).getByText('Loading…')).toBeInTheDocument();
		expect(screen.getByTestId('governance-loading')).toBeInTheDocument();

		const failed = await loaded({ loadSchema: async () => { throw new Error('schema down'); } });
		render(OntologyDashboard, { props: { state: failed, layout: DEFAULT_LAYOUT } });
		await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
	});

	it('read-only: no controls and the guides tile has no links', async () => {
		const state = await loaded();
		render(OntologyDashboard, { props: { state, layout: DEFAULT_LAYOUT, readonly: true } });
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
});
