import { describe, expect, it, vi } from 'vitest';
import { createOntologyDashboardState, type OntologyDashboardDeps } from './ontology-dashboard-state.svelte';
import type { FetchedSchema } from '#lib/services/sparql-connector.js';

const emptySchema = { classes: [], datatypeProperties: [], objectProperties: [], individuals: [], untypedIndividuals: [], shapes: [] } as unknown as FetchedSchema;
const NS = [
	{ baseIri: 'urn:ns:a', prefix: 'a', pipeline: true },
	{ baseIri: 'urn:ns:b', prefix: 'b', pipeline: false }
];

function deps(over: Partial<OntologyDashboardDeps> = {}): OntologyDashboardDeps {
	return {
		loadSchema: vi.fn(async () => emptySchema),
		loadNamespaces: vi.fn(async () => NS),
		loadQuestions: vi.fn(async () => ({ questions: [], runs: [] })),
		loadConcepts: vi.fn(async () => []),
		loadExtras: vi.fn(async () => ({ governance: { namespaceIri: 'urn:core', steward: 's', authority: '', maturity: '' as const, version: '1.0.0' }, collections: [], schemes: [] })),
		loadOpenRequests: vi.fn(async () => 2),
		loadChanges: vi.fn(async () => []),
		settings: () => ({ reviewPeriodMonths: 3, staleAfterMonths: 12 }),
		...over
	};
}

describe('ontologyDashboardState (STORY-474)', () => {
	it('lists only the namespaces of the pipeline and ends loading', async () => {
		const state = createOntologyDashboardState(deps());
		await state.load();
		expect(state.error).toBeNull();
		expect(state.loading).toBe(false);
		expect(state.summaries.map((s) => s.prefix)).toEqual(['a']);
		expect(state.hasPipelineNamespace).toBe(true);
		expect(state.detailsLoaded).toBe(true);
	});

	it('loads the schema in two phases, the cheap one first', async () => {
		const loadSchema = vi.fn(async (_variant: 'schema' | 'full') => emptySchema);
		const state = createOntologyDashboardState(deps({ loadSchema }));
		await state.load();
		expect(loadSchema.mock.calls.map((c) => c[0])).toEqual(['schema', 'full']);
	});

	it('loads the lazy tiles after the first render and keeps a failure inside its tile', async () => {
		const state = createOntologyDashboardState(
			deps({
				loadOpenRequests: vi.fn(async () => {
					throw new Error('requests down');
				}),
				loadChanges: vi.fn(async () => {
					throw new Error('log down');
				})
			})
		);
		await state.load();
		expect(state.error).toBeNull();
		expect(state.governance).toMatchObject({ status: 'ready', governance: { steward: 's' }, openRequests: null });
		expect(state.changes).toMatchObject({ status: 'error', error: 'log down' });
	});

	it('shows a failed governance read in the governance tile only', async () => {
		const state = createOntologyDashboardState(deps({ loadExtras: vi.fn(async () => { throw new Error('gov down'); }) }));
		await state.load();
		expect(state.governance).toMatchObject({ status: 'error', error: 'gov down' });
		expect(state.error).toBeNull();
		expect(state.problems).toEqual([]);
	});

	it('reports a failed schema load as the page error', async () => {
		const state = createOntologyDashboardState(deps({ loadSchema: vi.fn(async () => { throw new Error('schema down'); }) }));
		await state.load();
		expect(state.error).toBe('schema down');
		expect(state.loading).toBe(false);
	});

	it('treats a repository without a vocabulary as having no concepts to analyse', async () => {
		const state = createOntologyDashboardState(deps({ loadConcepts: vi.fn(async () => null) }));
		await state.load();
		expect(state.health).toEqual([]);
	});

	it('leaves the concept health empty, not failed, when the concepts cannot be read', async () => {
		const state = createOntologyDashboardState(deps({ loadConcepts: vi.fn(async () => { throw new Error('x'); }) }));
		await state.load();
		expect(state.error).toBeNull();
		expect(state.health).toEqual([]);
	});

	it('starts the lazy reads only once and before the details finish', async () => {
		const d = deps();
		const state = createOntologyDashboardState(d);
		await state.load();
		expect(d.loadExtras).toHaveBeenCalledTimes(1);
		expect(d.loadOpenRequests).toHaveBeenCalledTimes(1);
		expect(d.loadChanges).toHaveBeenCalledTimes(1);
	});
});
