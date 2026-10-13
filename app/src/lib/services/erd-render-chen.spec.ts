import { describe, expect, it } from 'vitest';
import { renderErd } from './erd-render';
import { assertWellFormedXml, fixtureModel, fixturePositions, iri } from './erd-render-testkit';

const render = (theme: 'light' | 'dark' = 'light') =>
	renderErd(fixtureModel(), fixturePositions, 'chen', { theme, legend: false });

const tags = (svg: string, pattern: string) => [...svg.matchAll(new RegExp(`<${pattern}[^>]*>`, 'g'))].map((m) => m[0]);
const legs = (svg: string, ref: string, end: string) =>
	tags(svg, 'line').filter((l) => l.includes(`data-ref="${ref}"`) && l.includes(`data-end="${end}"`));

describe('Chen renderer', () => {
	it('is strict, well-formed SVG without foreignObject', () => {
		const svg = render();
		assertWellFormedXml(svg);
		expect(svg.toLowerCase()).not.toContain('foreignobject');
	});

	it('draws one labelled diamond per relation, each with two connecting legs', () => {
		const svg = render();
		const diamonds = tags(svg, 'polygon').filter((p) => p.includes('data-kind="relationship"'));
		expect(diamonds).toHaveLength(4);
		for (let i = 0; i < 4; i++) {
			expect(svg).toContain(`>rel${i}</text>`);
			expect(legs(svg, iri(`rel${i}`), 'source').length).toBeGreaterThanOrEqual(1);
			expect(legs(svg, iri(`rel${i}`), 'target').length).toBeGreaterThanOrEqual(1);
		}
	});

	it('draws attributes as ellipses; inherited dotted, optional dashed, required solid, repeatable double', () => {
		const svg = render();
		const ellipses = tags(svg, 'ellipse');
		const outer = ellipses.filter((e) => e.includes('data-kind="attribute"'));
		expect(outer).toHaveLength(5); // Person 1 + Employee 2 + Company 1 + Employment 1
		expect(ellipses.filter((e) => e.includes('data-kind="attribute-inner"'))).toHaveLength(1); // tags[]
		const inherited = outer.filter((e) => e.includes('data-inherited="true"'));
		expect(inherited).toHaveLength(1);
		expect(inherited[0]).toContain('stroke-dasharray="2 3"');
		const required = outer.filter((e) => e.includes('data-required="true"') && !e.includes('data-inherited'));
		expect(required).toHaveLength(1);
		expect(required[0]).not.toContain('stroke-dasharray');
		expect(outer.filter((e) => e.includes('stroke-dasharray="6 4"'))).toHaveLength(3);
		expect(svg).toContain('>name (from Person)</text>');
		// every ellipse is linked to its entity by a plain attribute line
		expect(tags(svg, 'line').filter((l) => l.includes('data-kind="attribute"'))).toHaveLength(5);
	});

	it.each([
		['rel0', '1', 1],
		['rel1', '1', 2],
		['rel2', 'N', 1],
		['rel3', 'N', 2]
	])('labels %s with %s and draws %i target line(s)', (rel, label, lines) => {
		const svg = render();
		expect(svg).toMatch(new RegExp(`data-cardinality-of="${iri(rel)}"[^>]*>${label}<`));
		expect(legs(svg, iri(rel), 'target')).toHaveLength(lines);
		expect(legs(svg, iri(rel), 'source')).toHaveLength(1); // source side carries no label/double line
	});

	it('draws inheritance as ISA triangles with a line to each side', () => {
		const svg = render();
		const isa = tags(svg, 'polygon').filter((p) => p.includes('data-kind="isa"'));
		expect(isa).toHaveLength(2);
		expect((svg.match(/>ISA<\/text>/g) ?? []).length).toBe(2);
		expect(tags(svg, 'line').filter((l) => l.includes('data-kind="inheritance"'))).toHaveLength(4);
	});

	it('draws association classes as an entity rectangle with a relationship diamond and labelled links', () => {
		const svg = render();
		expect(svg).toMatch(/<polygon[^>]*data-kind="association-class-diamond"/);
		expect(svg).toMatch(new RegExp(`data-cardinality-of="${iri('forCompany')}"[^>]*>N<`));
		expect(legs(svg, iri('forPerson'), 'target').length + tags(svg, 'line').filter((l) => l.includes(`data-ref="${iri('forPerson')}"`)).length).toBeGreaterThan(0);
	});

	it('draws entities as rectangles, externals dashed, and applies the theme', () => {
		const svg = render();
		expect(svg).toContain('fill="#3366cc"');
		expect(svg).toMatch(/<rect[^>]*data-external="true"[^>]*stroke-dasharray/);
		const dark = render('dark');
		expect(dark).toContain('fill="#0f172a"');
		expect(dark).toContain('fill="#1e293b"');
	});
});
