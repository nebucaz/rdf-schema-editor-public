import { describe, expect, it } from 'vitest';
import { heuristicMeasurer, lightTheme } from '$lib/utils/erd-svg';
import { layoutErd, type Notation } from './erd-layout';
import { legendEntries, buildLegend } from './erd-legend';
import { renderErd } from './erd-render';
import { assertWellFormedXml, fixtureModel, fixturePositions } from './erd-render-testkit';

const notations: Notation[] = ['crows-foot', 'uml', 'chen'];
const texts = (n: Notation) => legendEntries(n).map((e) => e.text);

describe('legendEntries', () => {
	it.each(notations)('lists the four cardinalities, generalisation, association class, inherited and external (%s)', (n) => {
		const all = texts(n).join('\n');
		for (const c of n === 'chen' ? ['1', 'N'] : ['0..1', '1', '0..*', '1..*']) expect(all).toContain(c);
		expect(all.toLowerCase()).toContain('association class');
		expect(all.toLowerCase()).toContain('inherited');
		expect(all.toLowerCase()).toContain('external');
		expect(all.toLowerCase()).toMatch(n === 'chen' ? /isa/ : /generalisation/);
		expect(all).toContain('target');
	});

	it('states the STORY-151 conventions', () => {
		expect(texts('crows-foot').join('\n')).toContain('hollow triangle');
		expect(texts('crows-foot').join('\n')).toContain('rounded');
		expect(texts('uml').join('\n')).toContain('dashed line');
		expect(texts('chen').join('\n')).toContain('double line');
		expect(texts('chen').join('\n')).toContain('dotted');
	});

	it('shows relationship/ellipse symbols for Chen', () => {
		expect(texts('chen').join('\n').toLowerCase()).toContain('relationship');
		expect(texts('chen').join('\n').toLowerCase()).toContain('attribute');
	});
});

describe('buildLegend', () => {
	it.each(notations)('has a positive size and one row per entry (%s)', (n) => {
		const l = buildLegend(n, lightTheme, heuristicMeasurer);
		expect(l.width).toBeGreaterThan(100);
		expect(l.height).toBeGreaterThan(legendEntries(n).length * 20);
		const svg = l.body.join('');
		for (const e of legendEntries(n)) expect(svg).toContain(e.text.replace(/&/g, '&amp;'));
	});
});

describe('renderErd legend option', () => {
	const model = fixtureModel();
	const viewBoxOf = (svg: string) => svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);

	it.each(notations)('is on by default, inside the viewBox and below the diagram (%s)', (n) => {
		const svg = renderErd(model, fixturePositions, n);
		assertWellFormedXml(svg);
		const g = svg.match(/<g data-legend="true" transform="translate\(([-\d.]+) ([-\d.]+)\)">/)!;
		const [lx, ly] = [Number(g[1]), Number(g[2])];
		const frame = svg.match(/<rect data-legend-frame="true"[^>]*width="([\d.]+)" height="([\d.]+)"/)!;
		const [vx, vy, vw, vh] = viewBoxOf(svg);
		expect(lx).toBeGreaterThanOrEqual(vx);
		expect(ly).toBeGreaterThanOrEqual(vy);
		expect(lx + Number(frame[1])).toBeLessThanOrEqual(vx + vw + 0.01);
		expect(ly + Number(frame[2])).toBeLessThanOrEqual(vy + vh + 0.01);
		const layout = layoutErd(model, fixturePositions, n, heuristicMeasurer);
		expect(ly).toBeGreaterThanOrEqual(layout.bounds.y + layout.bounds.height);
	});

	it.each(notations)('is omitted entirely with legend=false (%s)', (n) => {
		const on = renderErd(model, fixturePositions, n);
		const off = renderErd(model, fixturePositions, n, { legend: false });
		expect(off).not.toContain('data-legend');
		expect(off).not.toContain('Legend');
		expect(on).toContain('data-legend');
		expect(viewBoxOf(off)[3]).toBeLessThan(viewBoxOf(on)[3]);
	});

	it('reuses the diagram marker ids instead of redefining them', () => {
		const svg = renderErd(model, fixturePositions, 'crows-foot');
		expect(svg).toContain('marker-end="url(#erd-cf-zero-many)"');
		expect(svg.split('id="erd-cf-zero-many"').length - 1).toBe(1);
	});
});
