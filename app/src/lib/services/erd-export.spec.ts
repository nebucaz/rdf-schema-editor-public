import { describe, expect, it } from 'vitest';
import { heuristicMeasurer } from '$lib/utils/erd-svg';
import type { CanvasModel, EntityNodeSpec } from './canvas-model';
import { buildErdSvg } from './erd-export';

const NS = 'http://example.org/a';
const iri = (n: string) => `${NS}#${n}`;

function entity(name: string): EntityNodeSpec {
	return { kind: 'entity', iri: iri(name), name, description: '', attributes: [], relationFields: [], members: [], namespace: NS, labelRequired: false };
}

const canvas = {
	nodes: [entity('A'), entity('B'), entity('C')],
	edges: [
		{ kind: 'relation', iri: iri('ab'), source: iri('A'), target: iri('B'), name: 'ab', required: false, repeatable: false, relationKind: 'specific', namespace: NS },
		{ kind: 'relation', iri: iri('bc'), source: iri('B'), target: iri('C'), name: 'bc', required: false, repeatable: false, relationKind: 'specific', namespace: NS }
	],
	associationClassIris: new Set<string>()
} as unknown as CanvasModel;

const base = {
	canvas,
	memberIris: new Set([iri('A'), iri('B'), iri('C')]),
	positionOf: (i: string) => ({ A: { x: 0, y: 0 }, B: { x: 400, y: 0 }, C: { x: 800, y: 0 } })[i.split('#')[1] as 'A'],
	namespaceColors: new Map([[NS, '#336699']]),
	legend: false,
	theme: 'light' as const,
	measurer: heuristicMeasurer
};

describe('buildErdSvg', () => {
	it.each(['crows-foot', 'uml', 'chen'] as const)('renders the workspace in %s notation', (notation) => {
		const svg = buildErdSvg({ ...base, notation });
		expect(svg.startsWith('<svg')).toBe(true);
		for (const n of ['A', 'B', 'C']) expect(svg).toContain(`>${n}</text>`);
		expect(svg).toContain('fill="#336699"');
	});

	it('follows the theme and legend flags', () => {
		expect(buildErdSvg({ ...base, notation: 'uml', theme: 'dark' })).toContain('fill="#0f172a"');
		expect(buildErdSvg({ ...base, notation: 'uml', legend: true })).toContain('data-legend');
	});

	it('limits the export to the selection and the relations between its members', () => {
		const svg = buildErdSvg({ ...base, notation: 'crows-foot', selection: new Set([iri('A'), iri('B')]) });
		expect(svg).toContain('>A</text>');
		expect(svg).not.toContain('>C</text>');
		expect(svg).toContain(`data-ref="${iri('ab')}"`);
		expect(svg).not.toContain(`data-ref="${iri('bc')}"`);
	});
});
