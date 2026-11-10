import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import GateReportView from './GateReportView.svelte';
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

describe('GateReportView', () => {
	it('groups findings by stage, warnings before info, and links each to its element', async () => {
		render(GateReportView, { props: { load: async () => schema } });
		const ontology = (await screen.findByRole('heading', { name: /Ontology/ })).closest('section') as HTMLElement;

		const items = within(ontology).getAllByRole('listitem');
		expect(items[0].textContent).toContain('Alpha');
		expect(items[0].textContent).toContain('no description');
		expect(items[0].textContent).toContain('Warning');
		expect(items.at(-1)!.textContent).toContain('Info');

		const link = within(items[0]).getByRole('link');
		expect(link.getAttribute('href')).toBe('/?focus=http%3A%2F%2Fe%23A');
		expect(screen.queryByRole('heading', { name: /Vocabulary/ })).toBeNull();
	});

	it('says so when there is nothing to report', async () => {
		const clean = { ...schema, classes: [] } as FetchedSchema;
		render(GateReportView, { props: { load: async () => clean } });
		expect(await screen.findByText('No findings.')).toBeTruthy();
	});

	it('shows a load error instead of a report', async () => {
		render(GateReportView, {
			props: {
				load: async () => {
					throw new Error('GraphDB unreachable');
				}
			}
		});
		expect((await screen.findByRole('alert')).textContent).toContain('GraphDB unreachable');
	});

	it('names how many findings there are and that they never block anything', async () => {
		render(GateReportView, { props: { load: async () => schema } });
		expect((await screen.findByTestId('gate-summary')).textContent).toMatch(/3 findings/);
		expect(screen.getByText(/never block/i)).toBeTruthy();
	});

	it('adds a Vocabulary group from the loaded concepts and links to the concept (STORY-324)', async () => {
		const concept: Concept = {
			iri: 'http://e/core/vocab#Customer',
			prefLabels: [{ text: 'Customer', lang: 'en' }],
			altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', disambiguation: '',
			schemeIri: '', topConcept: false, status: 'active', source: 's', authority: 'a',
			replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: ''
		};
		render(GateReportView, { props: { load: async () => schema, loadConcepts: async () => [concept] } });
		const vocabulary = (await screen.findByRole('heading', { name: /Vocabulary/ })).closest('section') as HTMLElement;
		const [item] = within(vocabulary).getAllByRole('listitem');
		expect(item.textContent).toContain('no definition');
		expect(within(item).getByRole('link').getAttribute('href')).toBe('/vocabulary?concept=http%3A%2F%2Fe%2Fcore%2Fvocab%23Customer');
	});

	it('still reports the model when there is no vocabulary or it fails to load (STORY-324)', async () => {
		render(GateReportView, { props: { load: async () => schema, loadConcepts: async () => null } });
		expect(await screen.findByRole('heading', { name: /Ontology/ })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: /Vocabulary/ })).toBeNull();
	});

	it('shows the model findings even when the vocabulary cannot be loaded (STORY-324)', async () => {
		render(GateReportView, {
			props: {
				load: async () => schema,
				loadConcepts: async () => {
					throw new Error('vocab graph unreachable');
				}
			}
		});
		expect(await screen.findByRole('heading', { name: /Ontology/ })).toBeTruthy();
		expect(screen.getByText(/vocabulary could not be checked/i)).toBeTruthy();
	});

	describe('class and concept link findings (STORY-327)', () => {
		const linkConcept = (name: string, over: Partial<Concept> = {}): Concept => ({
			iri: `http://e/core/vocab#${name}`,
			prefLabels: [{ text: name, lang: 'en' }],
			altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
			schemeIri: '', topConcept: false, status: 'active', source: 's', authority: 'a',
			replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
			...over
		});
		const linked = {
			...schema,
			classes: [{ iri: `${NS}#A`, label: 'Alpha', comment: 'ok', namespaceBaseIri: NS, definedByConcept: 'http://e/core/vocab#Client' }]
		} as unknown as FetchedSchema;
		const concepts = [
			linkConcept('Client', { status: 'deprecated', replacedBy: 'http://e/core/vocab#Customer' }),
			linkConcept('Customer')
		];

		it('offers to retarget a link to a deprecated concept and reloads afterwards', async () => {
			const load = vi.fn(async () => linked);
			const onRetarget = vi.fn(async () => {});
			render(GateReportView, { props: { load, loadConcepts: async () => concepts, onRetarget } });
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
			const onRetarget = vi.fn(async () => {
				throw new Error('write failed');
			});
			render(GateReportView, { props: { load: async () => linked, loadConcepts: async () => concepts, onRetarget } });
			await fireEvent.click(await screen.findByRole('button', { name: 'Retarget to Customer' }));
			expect(await screen.findByText('write failed')).toBeTruthy();
		});

		it('reports nothing about concepts when there is no vocabulary', async () => {
			render(GateReportView, { props: { load: async () => schema, loadConcepts: async () => null } });
			await screen.findByRole('heading', { name: /Ontology/ });
			expect(screen.queryByText(/vocabulary concept/)).toBeNull();
		});
	});
});

describe('GateReportView governance (STORY-331)', () => {
	it('reports a core namespace without steward, authority or version, linking to Governance', async () => {
		render(GateReportView, {
			props: {
				load: async () => ({ ...schema, classes: [] }) as FetchedSchema,
				loadGovernance: async () => ({ namespaceIri: 'http://e/core', steward: '', authority: 'x', maturity: '', version: '' })
			}
		});
		const section = (await screen.findByRole('heading', { name: /Governance/ })).closest('section') as HTMLElement;
		expect(within(section).getByText(/no steward, version/)).toBeTruthy();
		expect(within(section).getByRole('link').getAttribute('href')).toBe('/governance');
	});
});
