import { describe, expect, it } from 'vitest';
import { classesOfNamespace, placeClasses } from './namespace-class-placement';
import { gridPosition } from '#lib/stores/layout-store.js';
import type { FetchedSchema } from './sparql-connector';

const A = 'https://example.com/a';
const B = 'https://example.com/b';

const cls = (iri: string, label: string, namespaceBaseIri: string | undefined) => ({ iri, label, comment: null, namespaceBaseIri });
const schema = {
	classes: [
		cls('urn:a:Zed', 'Zed', A),
		cls('urn:a:Alpha', 'Alpha', A),
		cls('urn:b:Other', 'Other', B),
		cls('urn:a:Alpha2', 'Alpha', A),
		cls('urn:ext:Stub', 'Stub', undefined)
	]
} as unknown as FetchedSchema;

describe('classesOfNamespace', () => {
	it('returns only classes of the namespace, ordered by label then IRI', () => {
		const rows = classesOfNamespace(schema, A, new Set());
		expect(rows.map((r) => r.iri)).toEqual(['urn:a:Alpha', 'urn:a:Alpha2', 'urn:a:Zed']);
	});

	it('flags classes already on the workspace', () => {
		const rows = classesOfNamespace(schema, A, new Set(['urn:a:Zed']));
		expect(rows.map((r) => [r.iri, r.alreadyOnWorkspace])).toEqual([
			['urn:a:Alpha', false],
			['urn:a:Alpha2', false],
			['urn:a:Zed', true]
		]);
	});

	it('excludes external stubs without a namespace', () => {
		expect(classesOfNamespace(schema, A, new Set()).some((r) => r.iri === 'urn:ext:Stub')).toBe(false);
	});

	it('returns an empty list for an empty or unknown namespace', () => {
		expect(classesOfNamespace(schema, 'https://example.com/none', new Set())).toEqual([]);
		expect(classesOfNamespace({ classes: [] } as unknown as FetchedSchema, A, new Set())).toEqual([]);
	});

	it('does not mutate its inputs', () => {
		const members = new Set(['urn:a:Zed']);
		classesOfNamespace(schema, A, members);
		expect([...members]).toEqual(['urn:a:Zed']);
	});
});

describe('placeClasses', () => {
	it('starts at the origin and follows the shared grid', () => {
		const placed = placeClasses(['i0', 'i1', 'i2', 'i3', 'i4'], { x: 100, y: 50 });
		expect(placed[0]).toEqual({ iri: 'i0', x: 100, y: 50 });
		for (const [n, p] of placed.entries()) {
			const g = gridPosition(n);
			expect(p).toEqual({ iri: `i${n}`, x: 100 + g.x, y: 50 + g.y });
		}
	});

	it('gives N distinct, non-overlapping positions', () => {
		const iris = Array.from({ length: 37 }, (_, i) => `urn:c${i}`);
		const placed = placeClasses(iris, { x: 0, y: 0 });
		expect(new Set(placed.map((p) => `${p.x},${p.y}`)).size).toBe(37);
	});

	it('returns nothing for no classes', () => {
		expect(placeClasses([], { x: 5, y: 5 })).toEqual([]);
	});
});
