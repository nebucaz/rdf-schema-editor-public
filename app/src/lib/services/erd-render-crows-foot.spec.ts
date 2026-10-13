import { describe, expect, it } from 'vitest';
import { renderErd } from './erd-render';
import { assertWellFormedXml, ent, fixtureModel, fixturePositions, iri } from './erd-render-testkit';

const render = (theme: 'light' | 'dark' = 'light', model = fixtureModel()) =>
	renderErd(model, fixturePositions, 'crows-foot', { theme, legend: false });

const MARKERS: Record<string, string> = {
	'0..1': 'erd-cf-zero-one',
	'1': 'erd-cf-one',
	'0..*': 'erd-cf-zero-many',
	'1..*': 'erd-cf-one-many'
};

describe('Crow\'s Foot renderer', () => {
	it('is strict, well-formed SVG', () => {
		const svg = render();
		expect(svg.startsWith('<svg')).toBe(true);
		expect(svg.toLowerCase()).not.toContain('foreignobject');
		assertWellFormedXml(svg);
	});

	it.each(Object.entries(MARKERS))('draws cardinality %s with its marker on the target end and a plain source end', (card, id) => {
		const svg = render();
		const relIdx = ['0..1', '1', '0..*', '1..*'].indexOf(card);
		const line = svg.match(new RegExp(`<[^>]*data-ref="${iri('rel' + relIdx)}"[^>]*>`))![0];
		expect(line).toContain(`marker-end="url(#${id})"`);
		expect(line).not.toContain('marker-start');
	});

	it('draws 0..* on every relation source end when the source marker is enabled', () => {
		const svg = renderErd(fixtureModel(), fixturePositions, 'crows-foot', { legend: false, sourceMarker: true });
		const line = svg.match(new RegExp(`<[^>]*data-ref="${iri('rel0')}"[^>]*>`))![0];
		expect(line).toContain('marker-start="url(#erd-cf-zero-many)"');
		expect(line).toContain('marker-end="url(#erd-cf-zero-one)"');
	});

	it('composes each marker from the right primitives', () => {
		const svg = render();
		const marker = (id: string) => svg.match(new RegExp(`<marker id="${id}".*?</marker>`))![0];
		const count = (s: string, tag: string) => (s.match(new RegExp(`<${tag}\\b`, 'g')) ?? []).length;
		expect([count(marker('erd-cf-zero-one'), 'circle'), count(marker('erd-cf-zero-one'), 'line')]).toEqual([1, 1]);
		expect([count(marker('erd-cf-one'), 'circle'), count(marker('erd-cf-one'), 'line')]).toEqual([0, 2]);
		expect([count(marker('erd-cf-zero-many'), 'circle'), count(marker('erd-cf-zero-many'), 'line')]).toEqual([1, 3]);
		expect([count(marker('erd-cf-one-many'), 'circle'), count(marker('erd-cf-one-many'), 'line')]).toEqual([0, 4]);
	});

	it('defines each shared marker exactly once in <defs>', () => {
		const svg = render();
		for (const id of [...Object.values(MARKERS), 'erd-generalization']) {
			expect(svg.split(`id="${id}"`).length - 1).toBe(1);
		}
		expect(svg.indexOf('<defs>')).toBeLessThan(svg.indexOf('<marker'));
	});

	it('draws entity header, own attributes and visibly marks inherited attributes', () => {
		const svg = render();
		expect(svg).toContain('>Person</text>');
		expect(svg).toContain('fill="#3366cc"'); // namespace-coloured header
		expect(svg).toContain('* name : string');
		expect(svg).toContain('o badge : string');
		expect(svg).toContain('o tags : string[]');
		const inherited = svg.match(/<text[^>]*>\* name : string \(from Person\)<\/text>/)![0];
		expect(inherited).toContain('font-style="italic"');
	});

	it('draws a hollow triangle on the supertype end for inheritance, including externals', () => {
		const svg = render();
		const lines = [...svg.matchAll(/<[^>]*data-kind="inheritance"[^>]*>/g)].map((m) => m[0]);
		expect(lines).toHaveLength(2);
		for (const l of lines) expect(l).toContain('marker-end="url(#erd-generalization)"');
		expect(svg).toContain('foaf:Agent');
		expect(svg).toMatch(/stroke-dasharray="[^"]+"[^>]*data-external|data-external[^>]*stroke-dasharray/);
	});

	it('draws association classes as rounded boxes with cardinality-marked links', () => {
		const svg = render();
		expect(svg).toMatch(/<rect[^>]*data-iri="[^"]*Employment"[^>]*rx="/);
		const link = svg.match(new RegExp(`<[^>]*data-ref="${iri('forCompany')}"[^>]*>`))![0];
		expect(link).toContain('marker-end="url(#erd-cf-zero-many)"');
		expect(svg).not.toMatch(/<rect[^>]*data-iri="[^"]*Person"[^>]*rx=/);
	});

	it('applies the theme palette', () => {
		const light = render('light');
		const dark = render('dark');
		expect(light).toContain('fill="#ffffff"');
		expect(dark).toContain('fill="#0f172a"'); // dark background
		expect(dark).toContain('fill="#1e293b"'); // dark surface
		expect(dark).not.toBe(light);
	});

	it('escapes hostile names', () => {
		const svg = render('light', { ...fixtureModel(), entities: [ent('A<&>"b', [{ name: "x'y" }])], relations: [], associationLinks: [], inheritances: [], externals: [] });
		assertWellFormedXml(svg);
		expect(svg).toContain('A&lt;&amp;&gt;&quot;b');
	});

	it('renders an empty model', () => {
		const svg = renderErd({ entities: [], externals: [], relations: [], associationLinks: [], inheritances: [] }, {}, 'crows-foot', { legend: false });
		assertWellFormedXml(svg);
		expect(svg).toContain('viewBox=');
	});
});
