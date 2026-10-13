import { describe, expect, it } from 'vitest';
import {
	darkTheme,
	el,
	escapeXml,
	headerColors,
	heuristicMeasurer,
	lightTheme,
	svgDocument
} from './erd-svg';

describe('escapeXml', () => {
	it('escapes & < > " and apostrophe', () => {
		expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
	});

	it('escapes ampersand first so entities are not double-escaped', () => {
		expect(escapeXml('<')).toBe('&lt;');
	});
});

describe('el', () => {
	it('escapes attribute values and text children', () => {
		expect(el('text', { 'data-x': '"&"' }, 'A<B')).toBe('<text data-x="&quot;&amp;&quot;">A&lt;B</text>');
	});

	it('self-closes elements without children and skips undefined attributes', () => {
		expect(el('rect', { x: 1, y: 2, fill: undefined })).toBe('<rect x="1" y="2"/>');
	});

	it('nests pre-built child elements verbatim', () => {
		expect(el('g', {}, [el('rect', { x: 0 }), el('circle', { r: 1 })])).toBe(
			'<g><rect x="0"/><circle r="1"/></g>'
		);
	});

	it('refuses to emit foreignObject in any casing', () => {
		expect(() => el('foreignObject')).toThrow(/foreignObject/);
		expect(() => el('FOREIGNOBJECT')).toThrow(/foreignObject/);
	});
});

describe('svgDocument', () => {
	const doc = svgDocument({
		viewBox: { x: -10, y: 5, width: 200, height: 100 },
		background: '#fff',
		defs: [el('marker', { id: 'm' })],
		body: el('rect', { x: 0 })
	});

	it('wraps with xmlns, viewBox, size, defs and a background rect', () => {
		expect(doc.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
		expect(doc).toContain('viewBox="-10 5 200 100"');
		expect(doc).toContain('width="200"');
		expect(doc).toContain('height="100"');
		expect(doc).toContain('<defs><marker id="m"/></defs>');
		expect(doc).toContain('<rect x="-10" y="5" width="200" height="100" fill="#fff"/>');
		expect(doc.endsWith('</svg>')).toBe(true);
	});

	it('never contains foreignObject and yields well-formed output for hostile labels', () => {
		const hostile = svgDocument({
			viewBox: { x: 0, y: 0, width: 10, height: 10 },
			body: el('text', { x: 0 }, `<Class & "Co's"> </text><foreignObject>`)
		});
		expect(hostile.toLowerCase()).not.toContain('<foreignobject');
		expect(doc.toLowerCase()).not.toContain('foreignobject');
		// every '<' that is not a tag we emitted must be escaped: strip known tags, nothing else remains
		const stripped = hostile.replace(/<\/?(svg|text|rect|defs)\b[^<>]*>/g, '');
		expect(stripped).not.toMatch(/[<>]/);
	});
});

describe('heuristicMeasurer', () => {
	it('is deterministic', () => {
		expect(heuristicMeasurer('Person', 12)).toBe(heuristicMeasurer('Person', 12));
	});

	it('is monotonic in string length', () => {
		let prev = heuristicMeasurer('', 12);
		for (const s of ['a', 'ab', 'abc', 'abc i', 'abc i W']) {
			const w = heuristicMeasurer(s, 12);
			expect(w).toBeGreaterThan(prev);
			prev = w;
		}
	});

	it('is monotonic in font size and weight', () => {
		expect(heuristicMeasurer('Person', 14)).toBeGreaterThan(heuristicMeasurer('Person', 12));
		expect(heuristicMeasurer('Person', 12, 'bold')).toBeGreaterThan(heuristicMeasurer('Person', 12));
	});

	it('is zero for the empty string', () => {
		expect(heuristicMeasurer('', 12)).toBe(0);
	});
});

describe('themes and headerColors', () => {
	it('has distinct light and dark palettes', () => {
		expect(lightTheme.background).not.toBe(darkTheme.background);
		for (const t of [lightTheme, darkTheme]) {
			for (const k of ['background', 'stroke', 'text', 'mutedText', 'headerFallback', 'surface'] as const) {
				expect(t[k]).toMatch(/^#[0-9a-f]{6}$/i);
			}
		}
	});

	it.each([
		['light', lightTheme],
		['dark', darkTheme]
	])('uses contrastTextColor on the namespace colour (%s theme)', (_n, theme) => {
		expect(headerColors(theme, '#ffffff')).toEqual({ fill: '#ffffff', text: '#000000' });
		expect(headerColors(theme, '#101820')).toEqual({ fill: '#101820', text: '#ffffff' });
	});

	it.each([
		['light', lightTheme],
		['dark', darkTheme]
	])('falls back to the theme header colour without a namespace colour (%s theme)', (_n, theme) => {
		const h = headerColors(theme, undefined);
		expect(h.fill).toBe(theme.headerFallback);
		expect(['#000000', '#ffffff']).toContain(h.text);
	});
});
