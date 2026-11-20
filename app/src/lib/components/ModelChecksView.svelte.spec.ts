import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import ModelChecksView from './ModelChecksView.svelte';
import { DEFAULT_MODEL_CHECKS_STATE } from '#lib/services/model-checks-model.js';
import type { FetchedSchema } from '#lib/services/sparql-connector.js';
import type { Concept } from '#lib/services/skos-concept.js';

const NS = 'http://e';
const schema = {
	classes: [
		{ iri: `${NS}#A`, label: 'Alpha', comment: null, namespaceBaseIri: NS },
		{ iri: `${NS}#B`, label: 'Beta', comment: 'ok', namespaceBaseIri: NS }
	],
	datatypeProperties: [],
	objectProperties: [],
	subClassOf: [],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: []
} as unknown as FetchedSchema;

const quiet = {
	loadConcepts: async () => null,
	loadGovernance: async () => null,
	loadStructure: async () => ({ collections: [], schemes: [] }),
	loadQuestions: async () => ({ questions: [], runs: [] })
};

const concept = (over: Partial<Concept> = {}): Concept => ({
	iri: 'http://e/core/vocab#Customer',
	prefLabels: [{ text: 'Customer', lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: 's', authority: 'a',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

describe('ModelChecksView', () => {
	it('lists every problem with its stage, severity, message and Open link, warnings first', async () => {
		render(ModelChecksView, { props: { ...quiet, load: async () => schema } });
		const rows = within((await screen.findAllByRole('table'))[0]).getAllByRole('row').slice(1);
		expect(rows.length).toBe(5);
		expect(rows[0].textContent).toContain('Warning');
		expect(rows[0].textContent).toContain('Ontology');
		expect(rows[0].textContent).toContain('Alpha');
		expect(within(rows[0]).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/?focus=http%3A%2F%2Fe%23A');
		expect(screen.getByTestId('model-checks-summary').textContent).toMatch(/5 problems/);
		expect(screen.getByText(/never block/i)).toBeTruthy();
	});

	it('links a vocabulary problem to its concept', async () => {
		render(ModelChecksView, { props: { ...quiet, load: async () => ({ ...schema, classes: [] }) as FetchedSchema, loadConcepts: async () => [concept()] } });
		const row = (await screen.findAllByRole('row')).find((r) => r.textContent?.includes('no definition'))!;
		expect(within(row).getByRole('link').getAttribute('href')).toBe('/vocabulary?concept=http%3A%2F%2Fe%2Fcore%2Fvocab%23Customer');
	});

	it('narrows by the state it is given', async () => {
		render(ModelChecksView, { props: { ...quiet, load: async () => schema, query: { ...DEFAULT_MODEL_CHECKS_STATE, q: 'beta' } } });
		await screen.findAllByRole('table');
		const rows = screen.getAllByRole('row').slice(1);
		expect(rows.length).toBeLessThan(5);
		expect(rows.every((r) => r.textContent?.includes('Beta'))).toBe(true);
	});

	it('reports a changed stage or severity filter through onStateChange, back on page 1', async () => {
		const onStateChange = vi.fn();
		render(ModelChecksView, { props: { ...quiet, load: async () => schema, query: { ...DEFAULT_MODEL_CHECKS_STATE, page: 2 }, onStateChange } });
		await fireEvent.change(await screen.findByLabelText('Severity'), { target: { value: 'warning' } });
		expect(onStateChange).toHaveBeenLastCalledWith({ stage: '', severity: 'warning', q: '', page: 1 });
		await fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'ontology' } });
		expect(onStateChange).toHaveBeenLastCalledWith({ stage: 'ontology', severity: '', q: '', page: 1 });
	});

	it('says "No model problems" when the gates find nothing, and nothing about gates left silent', async () => {
		render(ModelChecksView, { props: { ...quiet, load: async () => ({ ...schema, classes: [] }) as FetchedSchema } });
		expect(await screen.findByText('No model problems')).toBeTruthy();
		expect(screen.queryByText(/silent|skipped|not checked/i)).toBeNull();
	});

	it('shows a load error instead of a list', async () => {
		render(ModelChecksView, {
			props: {
				...quiet,
				load: async () => {
					throw new Error('GraphDB unreachable');
				}
			}
		});
		expect((await screen.findByRole('alert')).textContent).toContain('GraphDB unreachable');
	});

	it('still lists the model when the vocabulary cannot be loaded', async () => {
		render(ModelChecksView, {
			props: {
				...quiet,
				load: async () => schema,
				loadConcepts: async () => {
					throw new Error('vocab graph unreachable');
				}
			}
		});
		expect(await screen.findAllByRole('table')).toBeTruthy();
		expect(screen.getByText(/vocabulary could not be checked/i)).toBeTruthy();
	});

	it('runs the question gates with the loaded questions', async () => {
		render(ModelChecksView, {
			props: {
				...quiet,
				load: async () => schema,
				loadQuestions: async () => {
					throw new Error('questions unreachable');
				}
			}
		});
		await screen.findAllByRole('table');
		expect(screen.queryByText(/not needed by any competency question/)).toBeNull();
		cleanup();
		render(ModelChecksView, { props: { ...quiet, load: async () => schema, loadQuestions: async () => ({ questions: [], runs: [] }) } });
		await screen.findAllByRole('table');
		expect(screen.getAllByText(/not needed by any competency question/).length).toBeGreaterThan(0);
	});

	it('offers to retarget a link to a deprecated concept and reloads afterwards', async () => {
		const linked = {
			...schema,
			classes: [{ iri: `${NS}#A`, label: 'Alpha', comment: 'ok', namespaceBaseIri: NS, definedByConcept: 'http://e/core/vocab#Client' }]
		} as unknown as FetchedSchema;
		const concepts = [concept({ iri: 'http://e/core/vocab#Client', status: 'deprecated', replacedBy: 'http://e/core/vocab#Customer', definitions: [{ text: 'd', lang: '' }] }), concept({ definitions: [{ text: 'd', lang: '' }] })];
		const load = vi.fn(async () => linked);
		const onRetarget = vi.fn(async () => {});
		render(ModelChecksView, { props: { ...quiet, load, loadConcepts: async () => concepts, onRetarget } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Retarget to Customer' }));
		expect(onRetarget).toHaveBeenCalledWith({
			kind: 'retarget-concept',
			classIri: `${NS}#A`,
			namespaceBaseIri: NS,
			conceptIri: 'http://e/core/vocab#Customer',
			conceptLabel: 'Customer'
		});
		await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
	});

	it('shows the refusal when retargeting fails', async () => {
		const linked = {
			...schema,
			classes: [{ iri: `${NS}#A`, label: 'Alpha', comment: 'ok', namespaceBaseIri: NS, definedByConcept: 'http://e/core/vocab#Client' }]
		} as unknown as FetchedSchema;
		const concepts = [concept({ iri: 'http://e/core/vocab#Client', status: 'deprecated', replacedBy: 'http://e/core/vocab#Customer', definitions: [{ text: 'd', lang: '' }] }), concept({ definitions: [{ text: 'd', lang: '' }] })];
		const onRetarget = vi.fn(async () => {
			throw new Error('write failed');
		});
		render(ModelChecksView, { props: { ...quiet, load: async () => linked, loadConcepts: async () => concepts, onRetarget } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Retarget to Customer' }));
		expect(await screen.findByText('write failed')).toBeTruthy();
	});
});

describe('ModelChecksView thresholds (STORY-463)', () => {
	const store = (initial = { reviewPeriodMonths: 3, staleAfterMonths: 12 }) => {
		let value = initial;
		return { get: () => value, set: vi.fn((v: typeof initial) => (value = v)) };
	};
	const stale = concept({ definitions: [{ text: 'd', lang: '' }], modified: '2025-01-01', created: '2025-01-01' });
	const props = (settingsStore: ReturnType<typeof store>) => ({
		...quiet,
		load: async () => ({ ...schema, classes: [] }) as FetchedSchema,
		loadConcepts: async () => [stale],
		settingsStore,
		now: new Date('2026-06-01T00:00:00Z')
	});

	it('keeps the two inputs in a collapsed Thresholds disclosure showing the stored values', async () => {
		render(ModelChecksView, { props: props(store({ reviewPeriodMonths: 6, staleAfterMonths: 24 })) });
		const details = (await screen.findByText('Thresholds')).closest('details') as HTMLDetailsElement;
		expect(details.open).toBe(false);
		expect((screen.getByLabelText('Question review period (months)') as HTMLInputElement).value).toBe('6');
		expect((screen.getByLabelText('Concept stale after (months)') as HTMLInputElement).value).toBe('24');
	});

	it('stores a valid change and re-runs the gates', async () => {
		const settingsStore = store();
		render(ModelChecksView, { props: props(settingsStore) });
		await screen.findByText('Thresholds');
		expect(screen.getAllByText(/not been touched/).length).toBeGreaterThan(0);
		await fireEvent.change(screen.getByLabelText('Concept stale after (months)'), { target: { value: '60' } });
		expect(settingsStore.set).toHaveBeenCalledWith({ reviewPeriodMonths: 3, staleAfterMonths: 60 });
		expect(screen.queryByText(/not been touched/)).toBeNull();
	});

	it.each(['', '0', '-2', '1.5', 'abc'])('rejects %j and keeps the previous value', async (bad) => {
		const settingsStore = store();
		render(ModelChecksView, { props: props(settingsStore) });
		await screen.findByText('Thresholds');
		const input = screen.getByLabelText('Question review period (months)') as HTMLInputElement;
		await fireEvent.change(input, { target: { value: bad } });
		expect(settingsStore.set).not.toHaveBeenCalled();
		expect(input.value).toBe('3');
	});
});

