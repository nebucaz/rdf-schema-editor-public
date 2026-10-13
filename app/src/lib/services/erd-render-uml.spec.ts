import { describe, expect, it } from 'vitest';
import { renderErd } from './erd-render';
import { assertWellFormedXml, fixtureModel, fixturePositions, iri } from './erd-render-testkit';

const render = (theme: 'light' | 'dark' = 'light') =>
	renderErd(fixtureModel(), fixturePositions, 'uml', { theme, legend: false });

const tagOf = (svg: string, attr: string, value: string) =>
	[...svg.matchAll(new RegExp(`<[^>]*${attr}="${value}"[^>]*>`, 'g'))].map((m) => m[0]);

describe('UML renderer', () => {
	it('is strict, well-formed SVG without foreignObject', () => {
		const svg = render();
		assertWellFormedXml(svg);
		expect(svg.toLowerCase()).not.toContain('foreignobject');
	});

	it('labels the target end of each association with its multiplicity', () => {
		const svg = render();
		const labelFor = (ref: string) => svg.match(new RegExp(`<text[^>]*data-multiplicity-of="${ref}"[^>]*>([^<]*)</text>`))?.[1];
		expect(labelFor(iri('rel0'))).toBe('0..1');
		expect(labelFor(iri('rel1'))).toBe('1');
		expect(labelFor(iri('rel2'))).toBe('0..*');
		expect(labelFor(iri('rel3'))).toBe('1..*');
		// association lines have no arrowheads
		for (const l of tagOf(svg, 'data-ref', iri('rel0'))) expect(l).not.toContain('marker-end');
	});

	it('labels a relation with its exact sh:minCount..sh:maxCount when it differs from the symbol', () => {
		const model = fixtureModel();
		model.relations[0] = { ...model.relations[0], cardinality: '1..*', multiplicity: '2..5' };
		const svg = renderErd(model, fixturePositions, 'uml', { legend: false });
		expect(svg.match(new RegExp(`<text[^>]*data-multiplicity-of="${iri('rel0')}"[^>]*>([^<]*)</text>`))?.[1]).toBe('2..5');
	});

	it('draws generalisation with a hollow triangle at the superclass end', () => {
		const svg = render();
		const lines = tagOf(svg, 'data-kind', 'inheritance');
		expect(lines).toHaveLength(2);
		for (const l of lines) expect(l).toContain('marker-end="url(#erd-generalization)"');
		const marker = svg.match(/<marker id="erd-generalization".*?<\/marker>/)![0];
		expect(marker).toContain('fill="#ffffff"');
		expect(svg.split('id="erd-generalization"').length - 1).toBe(1);
	});

	it('draws an association class as a class box with a dashed link to a hollow n-ary diamond', () => {
		const svg = render();
		const dashed = tagOf(svg, 'data-kind', 'associationClass');
		expect(dashed).toHaveLength(1);
		expect(dashed[0]).toContain('stroke-dasharray=');
		expect(svg).toMatch(/<polygon[^>]*data-kind="association-diamond"[^>]*fill="#ffffff"/);
		expect(svg).toMatch(/<rect[^>]*data-iri="[^"]*Employment"/);
		// links from the diamond carry their multiplicity at the entity end
		expect(svg).toMatch(new RegExp(`data-multiplicity-of="${iri('forCompany')}"[^>]*>0\\.\\.\\*<`));
		expect(svg).toMatch(new RegExp(`data-multiplicity-of="${iri('forPerson')}"[^>]*>1<`));
	});

	it('shows attributes as "name : type" and marks inherited ones with their origin', () => {
		const svg = render();
		expect(svg).toContain('>name : string</text>');
		expect(svg).toContain('badge : string[0..1]');
		expect(svg).toContain('tags : string[0..*]');
		const inherited = svg.match(/<text[^>]*>name : string \(from Person\)<\/text>/)![0];
		expect(inherited).toContain('font-style="italic"');
	});

	it('applies the dark theme', () => {
		const dark = render('dark');
		expect(dark).toContain('fill="#0f172a"');
		expect(dark).toContain('fill="#1e293b"');
		assertWellFormedXml(dark);
	});
});
