import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import TaxonomyGraph from './TaxonomyGraph.svelte';
import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';

const SCHEME = 'urn:scheme:a';
const schemes = [{ iri: SCHEME, name: 'A', description: '', scope: {} }] as unknown as ConceptScheme[];

const concept = (id: string, over: Partial<Concept> = {}): Concept =>
	({
		iri: `urn:c:${id}`,
		prefLabels: [{ text: id, lang: 'en' }],
		altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
		schemeIri: SCHEME, topConcept: false, status: 'active', source: '', authority: '',
		replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
		broader: [],
		...over
	}) as Concept;

const concepts = [
	concept('Animal', { topConcept: true, related: ['urn:c:Plant'], mappings: [{ kind: 'exactMatch', target: 'urn:c:Plant' }] }),
	concept('Dog', { broader: ['urn:c:Animal'] }),
	concept('Plant', { topConcept: true }),
	concept('Old', { broader: ['urn:c:Animal'], status: 'retired' })
];

const renderGraph = (over: Record<string, unknown> = {}) => {
	const onOpen = vi.fn();
	const view = render(TaxonomyGraph, { props: { concepts, schemes, schemeIri: SCHEME, onOpen, ...over } });
	return { onOpen, ...view };
};

describe('TaxonomyGraph', () => {
	it('renders a node per concept, the broader links and a legend', () => {
		const { container } = renderGraph();
		expect(screen.getByRole('button', { name: /^Open Animal/ })).toBeTruthy();
		expect(screen.getByRole('button', { name: /^Open Dog/ })).toBeTruthy();
		expect(container.querySelectorAll('[data-link-kind="broader"]')).toHaveLength(2);
		expect(screen.getByText('Broader')).toBeTruthy();
		expect(screen.getByText('Related')).toBeTruthy();
		expect(screen.getByText('Mapping')).toBeTruthy();
	});

	it('dims retired concepts', () => {
		const { container } = renderGraph();
		expect(container.querySelector('[data-iri="urn:c:Old"]')?.getAttribute('data-status')).toBe('retired');
	});

	it('shows related and mapping links by default and hides them when their toggles are turned off', async () => {
		const { container } = renderGraph();
		expect(container.querySelectorAll('[data-link-kind="related"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-link-kind="exactMatch"]')).toHaveLength(1);
		await fireEvent.click(screen.getByLabelText('Related links'));
		expect(container.querySelectorAll('[data-link-kind="related"]')).toHaveLength(0);
		await fireEvent.click(screen.getByLabelText('Mapping links'));
		expect(container.querySelectorAll('[data-link-kind="exactMatch"]')).toHaveLength(0);
	});

	it('draws each legend entry in its own link style, and same concept differs from broader', () => {
		const { container } = renderGraph();
		const legend = container.querySelector('.legend')!;
		for (const kind of ['broader', 'related', 'exactMatch', 'duplicate-of']) {
			expect(legend.querySelector(`line.${kind}`), kind).toBeTruthy();
		}
		const css = readFileSync('src/app.css', 'utf8');
		expect(css).toContain('--graph-link-same:');
	});

	it('opens a concept on click and on Enter', async () => {
		const { onOpen } = renderGraph();
		await fireEvent.click(screen.getByRole('button', { name: /^Open Dog/ }));
		expect(onOpen).toHaveBeenLastCalledWith('urn:c:Dog');
		await fireEvent.keyDown(screen.getByRole('button', { name: /^Open Animal/ }), { key: 'Enter' });
		expect(onOpen).toHaveBeenLastCalledWith('urn:c:Animal');
	});

	it('offers an expand control for a truncated scheme that reveals the next level', async () => {
		const { container } = renderGraph({ maxNodes: 2 });
		expect(container.querySelector('[data-iri="urn:c:Dog"]')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /Show 2 hidden concepts below Animal/ }));
		expect(container.querySelector('[data-iri="urn:c:Dog"]')).not.toBeNull();
		expect(screen.queryByRole('button', { name: /hidden concepts below/ })).toBeNull();
	});

	it('is read-only: no connector and no write call', () => {
		const source = readFileSync('src/lib/components/TaxonomyGraph.svelte', 'utf8');
		expect(source).not.toMatch(/sparql-connector|sparqlConnector|fetch\(/);
	});

	it('defines its colour tokens for light and dark mode', () => {
		const css = readFileSync('src/app.css', 'utf8');
		for (const token of ['--graph-link-related', '--graph-link-mapping', '--graph-link-same', '--graph-node-fill']) {
			expect(css.split(token + ':').length - 1, token).toBeGreaterThanOrEqual(2);
		}
	});
});
