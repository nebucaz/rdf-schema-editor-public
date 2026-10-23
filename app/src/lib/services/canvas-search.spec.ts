import { describe, expect, it } from 'vitest';
import { MIN_PAN_ZOOM, panToNode, searchCanvasNodes, searchHighlightCss } from './canvas-search';

const entity = (id: string, name: string, hidden = false) => ({ id, type: 'entity', hidden, data: { name } });

const nodes = [
	entity('urn:a', 'Person'),
	entity('urn:b', 'Personal Record'),
	entity('urn:c', 'Organisation'),
	entity('urn:d', 'Hidden Person', true),
	{ id: 'urn:e', type: 'individual', hidden: false, data: { label: 'Person One' } },
	{ id: 'urn:f', type: 'note', hidden: false, data: { text: 'person note' } },
	{ id: 'urn:g', type: 'external', hidden: false, data: { prefixedName: 'foaf:Person' } }
];

describe('searchCanvasNodes', () => {
	it('matches visible class nodes case-insensitively by substring, sorted by name', () => {
		expect(searchCanvasNodes(nodes, 'PERSON').map((m) => m.id)).toEqual(['urn:a', 'urn:b']);
		expect(searchCanvasNodes(nodes, 'rec').map((m) => m.name)).toEqual(['Personal Record']);
	});

	it('never matches hidden nodes (other workspace or hidden namespace)', () => {
		expect(searchCanvasNodes(nodes, 'Hidden')).toEqual([]);
	});

	it('does not search individuals, notes or external classes', () => {
		const ids = searchCanvasNodes(nodes, 'person').map((m) => m.id);
		expect(ids).not.toContain('urn:e');
		expect(ids).not.toContain('urn:f');
		expect(ids).not.toContain('urn:g');
	});

	it('returns nothing for an empty or blank query', () => {
		expect(searchCanvasNodes(nodes, '')).toEqual([]);
		expect(searchCanvasNodes(nodes, '   ')).toEqual([]);
	});

	it('follows a changed node set (e.g. after a workspace switch)', () => {
		expect(searchCanvasNodes([entity('urn:z', 'Zebra')], 'zeb').map((m) => m.id)).toEqual(['urn:z']);
	});
});

describe('searchHighlightCss', () => {
	it('is empty while no search is active', () => {
		expect(searchHighlightCss('', [])).toBe('');
		expect(searchHighlightCss('  ', [])).toBe('');
	});

	it('dims every node and highlights the matches', () => {
		const css = searchHighlightCss('per', ['urn:a', 'urn:b']);
		expect(css).toContain('opacity');
		expect(css).toContain('[data-id="urn:a"]');
		expect(css).toContain('[data-id="urn:b"]');
	});

	it('dims everything when nothing matches', () => {
		const css = searchHighlightCss('zzz', []);
		expect(css).toContain('opacity');
		expect(css).not.toContain('data-id');
	});

	it('cannot be broken out of the <style> element by an id containing a closing tag', () => {
		expect(searchHighlightCss('x', ['a</style><b'])).not.toContain('</style><b');
	});

	it('escapes quotes and backslashes in ids so they cannot break out of the selector', () => {
		const css = searchHighlightCss('x', ['a"]{}b\\c']);
		expect(css).toContain('[data-id="a\\"]{}b\\\\c"]');
	});
});

describe('panToNode', () => {
	const size = { width: 200, height: 80 };

	it('centers the node in the canvas, keeping the zoom', () => {
		const vp = panToNode({ x: 0, y: 0, zoom: 1 }, 1000, 600, { x: 2000, y: 1000 }, size);
		// node center (2100, 1040) must land on the canvas center (500, 300)
		expect(2100 * vp.zoom + vp.x).toBeCloseTo(500, 6);
		expect(1040 * vp.zoom + vp.y).toBeCloseTo(300, 6);
		expect(vp.zoom).toBe(1);
	});

	it('works at other zoom levels', () => {
		const vp = panToNode({ x: 0, y: 0, zoom: 2 }, 1000, 600, { x: -300, y: 50 }, size);
		expect((-300 + 100) * 2 + vp.x).toBeCloseTo(500, 6);
		expect((50 + 40) * 2 + vp.y).toBeCloseTo(300, 6);
		expect(vp.zoom).toBe(2);
	});

	it('raises a very low zoom so the found node is readable', () => {
		const vp = panToNode({ x: 0, y: 0, zoom: 0.1 }, 1000, 600, { x: 0, y: 0 }, size);
		expect(vp.zoom).toBe(MIN_PAN_ZOOM);
		expect((0 + 100) * MIN_PAN_ZOOM + vp.x).toBeCloseTo(500, 6);
	});

	it('falls back to 800x600 before the canvas is measured', () => {
		expect(panToNode({ x: 0, y: 0, zoom: 1 }, 0, 0, { x: 0, y: 0 }, size)).toEqual(
			panToNode({ x: 0, y: 0, zoom: 1 }, 800, 600, { x: 0, y: 0 }, size)
		);
	});
});
