import { describe, expect, it } from 'vitest';
import type { ErdAttribute, ErdEntity, ErdModel } from './erd-model';
import { layoutErd, type ErdLayout, type Notation, type Rect } from './erd-layout';
import { heuristicMeasurer } from '$lib/utils/erd-svg';

const iri = (n: string) => `http://example.org/a#${n}`;

function ent(name: string, attrs: string[] = [], extra: Partial<ErdEntity> = {}): ErdEntity {
	return {
		iri: iri(name),
		name,
		namespace: 'http://example.org/a',
		isAssociationClass: false,
		attributes: attrs.map(
			(a): ErdAttribute => ({ name: a, datatype: 'string', required: false, repeatable: false })
		),
		...extra
	};
}

function mdl(p: Partial<ErdModel> & Pick<ErdModel, 'entities'>): ErdModel {
	return { externals: [], relations: [], associationLinks: [], inheritances: [], ...p };
}

function rel(name: string, s: string, t: string) {
	return {
		iri: iri(name),
		name,
		sourceIri: iri(s),
		targetIri: iri(t),
		cardinality: '0..1' as const,
		relationKind: 'specific' as const
	};
}

const GAP = 24;
const overlaps = (a: Rect, b: Rect, gap = 0) =>
	a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

const notations: Notation[] = ['crows-foot', 'uml', 'chen'];

function entityRects(l: ErdLayout) {
	return Object.values(l.entities);
}

describe('layoutErd — positions', () => {
	const model = mdl({ entities: [ent('A', ['x']), ent('B', ['y'])] });
	const stored = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 1000, y: 500 } };

	it.each(notations)('keeps stored positions when nothing overlaps (%s)', (n) => {
		const l = layoutErd(model, stored, n, heuristicMeasurer);
		expect(l.entities[iri('A')]).toMatchObject({ x: 0, y: 0 });
		expect(l.entities[iri('B')]).toMatchObject({ x: 1000, y: 500 });
	});

	it('is idempotent: re-running on its own output changes nothing', () => {
		const crowded = mdl({ entities: [ent('A', ['x']), ent('B', ['y']), ent('C')] });
		const pos = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 10, y: 10 }, [iri('C')]: { x: 20, y: 5 } };
		const first = layoutErd(crowded, pos, 'crows-foot', heuristicMeasurer);
		const again = layoutErd(
			crowded,
			Object.fromEntries(Object.entries(first.entities).map(([k, r]) => [k, { x: r.x, y: r.y }])),
			'crows-foot',
			heuristicMeasurer
		);
		expect(again.entities).toEqual(first.entities);
	});

	it.each(notations)('separates overlapping boxes by at least the minimum gap, deterministically (%s)', (n) => {
		const crowded = mdl({ entities: [ent('A', ['x']), ent('B', ['y']), ent('C')] });
		const pos = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 10, y: 10 }, [iri('C')]: { x: 20, y: 5 } };
		const l1 = layoutErd(crowded, pos, n, heuristicMeasurer);
		const l2 = layoutErd(crowded, pos, n, heuristicMeasurer);
		expect(l1).toEqual(l2);
		const rects = entityRects(l1);
		for (let i = 0; i < rects.length; i++)
			for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j], GAP - 0.001)).toBe(false);
	});

	it('gives entities without stored positions deterministic, non-overlapping placements', () => {
		const m = mdl({ entities: [ent('A'), ent('B'), ent('C'), ent('D', ['q'])] });
		const l1 = layoutErd(m, { [iri('A')]: { x: 0, y: 0 } }, 'uml', heuristicMeasurer);
		const l2 = layoutErd(m, { [iri('A')]: { x: 0, y: 0 } }, 'uml', heuristicMeasurer);
		expect(l1).toEqual(l2);
		const rects = entityRects(l1);
		expect(rects).toHaveLength(4);
		for (let i = 0; i < rects.length; i++)
			for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i], rects[j], GAP - 0.001)).toBe(false);
	});

	it('sizes boxes from attribute count and label width', () => {
		const small = layoutErd(mdl({ entities: [ent('A', ['x'])] }), {}, 'uml', heuristicMeasurer);
		const big = layoutErd(
			mdl({ entities: [ent('A', ['x', 'y', 'z', 'a_really_long_attribute_name_here'])] }),
			{},
			'uml',
			heuristicMeasurer
		);
		expect(big.entities[iri('A')].height).toBeGreaterThan(small.entities[iri('A')].height);
		expect(big.entities[iri('A')].width).toBeGreaterThan(small.entities[iri('A')].width);
	});
});

describe('layoutErd — Chen symbols', () => {
	const model = mdl({
		entities: [ent('A', ['a1', 'a2', 'a3', 'a4']), ent('B', ['b1', 'b2']), ent('C', ['c1'])],
		relations: [rel('r1', 'A', 'B'), rel('r2', 'A', 'B'), rel('self', 'C', 'C')],
		inheritances: [{ subIri: iri('C'), superIri: iri('A') }]
	});
	const pos = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 300, y: 0 }, [iri('C')]: { x: 150, y: 250 } };

	it('creates a diamond per relation, an ellipse per attribute and an ISA symbol', () => {
		const l = layoutErd(model, pos, 'chen', heuristicMeasurer);
		expect(l.symbols.filter((s) => s.kind === 'diamond')).toHaveLength(3);
		expect(l.symbols.filter((s) => s.kind === 'ellipse')).toHaveLength(7);
		expect(l.symbols.filter((s) => s.kind === 'isa')).toHaveLength(1);
	});

	it('never overlaps a symbol with an entity box or another symbol', () => {
		const l = layoutErd(model, pos, 'chen', heuristicMeasurer);
		for (const s of l.symbols) for (const e of entityRects(l)) expect(overlaps(s.rect, e)).toBe(false);
		for (let i = 0; i < l.symbols.length; i++)
			for (let j = i + 1; j < l.symbols.length; j++)
				expect(overlaps(l.symbols[i].rect, l.symbols[j].rect)).toBe(false);
	});

	it('creates no symbols for crow\'s foot', () => {
		expect(layoutErd(model, pos, 'crows-foot', heuristicMeasurer).symbols).toEqual([]);
	});
});

describe('layoutErd — edges', () => {
	it('computes boundary endpoints (not centres) for an entity relation', () => {
		const m = mdl({ entities: [ent('A'), ent('B')], relations: [rel('r', 'A', 'B')] });
		const l = layoutErd(m, { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 400, y: 0 } }, 'uml', heuristicMeasurer);
		const a = l.entities[iri('A')];
		const e = l.edges.find((x) => x.kind === 'relation')!;
		expect(e.from.x).toBeCloseTo(a.x + a.width, 0);
		expect(e.to.x).toBeCloseTo(l.entities[iri('B')].x, 0);
	});

	it('separates parallel relations between the same pair', () => {
		const m = mdl({ entities: [ent('A'), ent('B')], relations: [rel('r1', 'A', 'B'), rel('r2', 'A', 'B')] });
		const l = layoutErd(m, { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 400, y: 0 } }, 'crows-foot', heuristicMeasurer);
		const [e1, e2] = l.edges.filter((x) => x.kind === 'relation');
		expect(Math.abs(e1.from.y - e2.from.y)).toBeGreaterThan(5);
		expect(Math.abs(e1.to.y - e2.to.y)).toBeGreaterThan(5);
	});

	it('routes a self-relation as a loop outside the box', () => {
		const m = mdl({ entities: [ent('A')], relations: [rel('me', 'A', 'A')] });
		const l = layoutErd(m, { [iri('A')]: { x: 0, y: 0 } }, 'uml', heuristicMeasurer);
		const e = l.edges.find((x) => x.kind === 'relation')!;
		expect(e.loop?.path).toMatch(/^M /);
		expect(e.loop!.labelX).toBeGreaterThan(l.entities[iri('A')].x + l.entities[iri('A')].width);
		expect(l.bounds.x + l.bounds.width).toBeGreaterThan(e.loop!.labelX);
	});

	it('draws inheritance directly for UML/crow\'s foot and via the ISA symbol for Chen', () => {
		const m = mdl({
			entities: [ent('A'), ent('B')],
			inheritances: [{ subIri: iri('B'), superIri: iri('A') }]
		});
		const pos = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 0, y: 300 } };
		expect(layoutErd(m, pos, 'uml', heuristicMeasurer).edges.filter((e) => e.kind === 'inheritance')).toHaveLength(1);
		expect(layoutErd(m, pos, 'chen', heuristicMeasurer).edges.filter((e) => e.kind === 'inheritance')).toHaveLength(2);
	});

	it('places externals as boxes and routes UML association classes through a diamond', () => {
		const m = mdl({
			entities: [ent('P'), ent('Q'), ent('Emp', [], { isAssociationClass: true })],
			externals: [{ iri: 'http://x.org/Agent', prefixedName: 'foaf:Agent' }],
			associationLinks: [
				{ iri: iri('l1'), name: 'l1', associationIri: iri('Emp'), targetIri: iri('P'), cardinality: '1' },
				{ iri: iri('l2'), name: 'l2', associationIri: iri('Emp'), targetIri: iri('Q'), cardinality: '0..*' }
			]
		});
		const l = layoutErd(m, {}, 'uml', heuristicMeasurer);
		expect(l.entities['http://x.org/Agent']).toBeDefined();
		expect(l.symbols.filter((s) => s.kind === 'diamond')).toHaveLength(1);
		expect(l.edges.filter((e) => e.kind === 'associationLink')).toHaveLength(2);
		expect(l.edges.filter((e) => e.kind === 'associationClass')).toHaveLength(1);
	});
});

describe('layoutErd — bounds', () => {
	it.each(notations)('bounding box contains every entity and symbol (%s)', (n) => {
		const m = mdl({ entities: [ent('A', ['x', 'y']), ent('B', ['z'])], relations: [rel('r', 'A', 'B')] });
		const l = layoutErd(m, { [iri('A')]: { x: -50, y: -20 }, [iri('B')]: { x: 300, y: 200 } }, n, heuristicMeasurer);
		const all = [...entityRects(l), ...l.symbols.map((s) => s.rect)];
		for (const r of all) {
			expect(r.x).toBeGreaterThanOrEqual(l.bounds.x);
			expect(r.y).toBeGreaterThanOrEqual(l.bounds.y);
			expect(r.x + r.width).toBeLessThanOrEqual(l.bounds.x + l.bounds.width);
			expect(r.y + r.height).toBeLessThanOrEqual(l.bounds.y + l.bounds.height);
		}
	});

	it('is a finite empty box for an empty model', () => {
		const l = layoutErd(mdl({ entities: [] }), {}, 'uml', heuristicMeasurer);
		expect(l.bounds.width).toBeGreaterThan(0);
		expect(l.bounds.height).toBeGreaterThan(0);
	});
});

describe('layoutErd — orthogonal routes', () => {
	const model = mdl({ entities: [ent('A', ['x']), ent('B', ['y'])], relations: [rel('r', 'A', 'B')] });
	const pos = { [iri('A')]: { x: 0, y: 0 }, [iri('B')]: { x: 600, y: 400 } };

	it.each(['crows-foot', 'uml'] as const)('routes relations as axis-aligned segments (%s)', (n) => {
		const e = layoutErd(model, pos, n, heuristicMeasurer).edges.find((x) => x.kind === 'relation')!;
		expect(e.route!.length).toBeGreaterThan(2);
		for (let i = 1; i < e.route!.length; i++) {
			const [a, b] = [e.route![i - 1], e.route![i]];
			expect(a.x === b.x || a.y === b.y).toBe(true);
		}
		expect(e.route![0]).toEqual(e.from);
		expect(e.route![e.route!.length - 1]).toEqual(e.to);
	});
});
