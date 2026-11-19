import { describe, expect, it } from 'vitest';
import type { TileId } from './dashboard-layout.js';
import {
	DEFAULT_LAYOUT,
	arrangeColumns,
	isDefaultLayout,
	placeTile,
	resolvedColumns,
	TILE_IDS,
	hideTile,
	moveEarlier,
	moveLater,
	moveTile,
	normalizeLayout,
	parseDashboardLayout,
	resetLayout,
	showTile,
	type DashboardLayout
} from './dashboard-layout.js';

const sorted = (ids: readonly string[]) => [...ids].sort();
const isPermutation = (l: DashboardLayout) => expect(sorted([...l.order])).toEqual(sorted(TILE_IDS));

describe('dashboard layout (STORY-467)', () => {
	it('the default shows every tile once, in the default order', () => {
		expect(DEFAULT_LAYOUT.order).toEqual([...TILE_IDS]);
		expect(DEFAULT_LAYOUT.hidden).toEqual([]);
	});

	it('moves a tile without mutating the input', () => {
		const before = structuredClone(DEFAULT_LAYOUT);
		const next = moveTile(DEFAULT_LAYOUT, TILE_IDS[0], 3);
		expect(DEFAULT_LAYOUT).toEqual(before);
		expect(next.order[3]).toBe(TILE_IDS[0]);
		isPermutation(next);
	});

	it('clamps moves and keeps a permutation for every start and target', () => {
		for (const id of TILE_IDS) {
			for (const to of [-5, 0, 1, 4, TILE_IDS.length - 1, 99]) isPermutation(moveTile(DEFAULT_LAYOUT, id, to));
		}
	});

	it('moves one step earlier and later, and stops at the ends', () => {
		const [a, b] = TILE_IDS;
		expect(moveLater(DEFAULT_LAYOUT, a).order.slice(0, 2)).toEqual([b, a]);
		expect(moveEarlier(DEFAULT_LAYOUT, b).order.slice(0, 2)).toEqual([b, a]);
		expect(moveEarlier(DEFAULT_LAYOUT, a)).toEqual(DEFAULT_LAYOUT);
		expect(moveLater(DEFAULT_LAYOUT, TILE_IDS[TILE_IDS.length - 1])).toEqual(DEFAULT_LAYOUT);
	});

	it('hides and shows a tile; hiding keeps it in the order so it returns to its place', () => {
		const hidden = hideTile(DEFAULT_LAYOUT, 'guides');
		expect(hidden.hidden).toEqual(['guides']);
		isPermutation(hidden);
		expect(hideTile(hidden, 'guides').hidden).toEqual(['guides']);
		expect(showTile(hidden, 'guides')).toEqual(DEFAULT_LAYOUT);
		expect(DEFAULT_LAYOUT.hidden).toEqual([]);
	});

	it('reset returns the default layout', () => {
		expect(resetLayout()).toEqual(DEFAULT_LAYOUT);
	});

	it('normalize drops unknown ids and duplicates and appends tiles missing from the stored order', () => {
		const n = normalizeLayout({ order: ['guides', 'gone', 'guides', 'stages'], hidden: ['gone', 'stages', 'stages'] });
		expect(n.order.filter((id) => id === 'guides' || id === 'stages')).toEqual(['guides', 'stages']);
		isPermutation(n);
		expect(n.hidden).toEqual(['stages']);
	});

	it('normalize puts a tile introduced later at its default position among its neighbours', () => {
		const withoutLast = { order: TILE_IDS.slice(0, -1), hidden: [] };
		expect(normalizeLayout(withoutLast).order).toEqual([...TILE_IDS]);
	});

	it('parse accepts a valid stored layout', () => {
		const stored = JSON.stringify({ version: 1, order: [...TILE_IDS].reverse(), hidden: ['guides'] });
		expect(parseDashboardLayout(stored)).toEqual({ version: 1, order: [...TILE_IDS].reverse(), hidden: ['guides'] });
	});

	it('parse returns the default for malformed input instead of throwing', () => {
		for (const bad of [null, undefined, '', 'not json', '[]', '{"version":2,"order":[],"hidden":[]}', '{"version":1,"order":"x","hidden":[]}', '{"version":1,"order":[1],"hidden":[]}', '{"version":1,"order":[],"hidden":[3]}', 42]) {
			expect(parseDashboardLayout(bad as never)).toEqual(DEFAULT_LAYOUT);
		}
	});
});

describe('arrangeColumns', () => {
	it('puts each narrow tile in its preferred column, with every column present, between the full-row tiles', () => {
		const segments = arrangeColumns(
			['stages', 'scheme-health', 'getting-started', 'model-checks', 'questions', 'governance', 'guides'],
			3,
			{ 'getting-started': 0, 'model-checks': 1, questions: 2, governance: 0, guides: 0 }
		);
		expect(segments).toEqual([
			{ wide: 'stages' },
			{ wide: 'scheme-health' },
			{ columns: [['getting-started', 'governance', 'guides'], ['model-checks'], ['questions']] }
		]);
	});

	it('keeps empty columns and starts a new run after a full-row tile in the middle', () => {
		expect(arrangeColumns(['guides', 'stages', 'governance'], 3, { guides: 0, governance: 2 })).toEqual([
			{ columns: [['guides'], [], []] },
			{ wide: 'stages' },
			{ columns: [[], [], ['governance']] }
		]);
	});

	it('deals tiles without a preference left to right and folds a preference beyond the last column', () => {
		expect(arrangeColumns(['guides', 'governance', 'questions'], 2)).toEqual([{ columns: [['guides', 'questions'], ['governance']] }]);
		expect(arrangeColumns(['guides', 'governance'], 2, { guides: 5, governance: 0 })).toEqual([{ columns: [['governance'], ['guides']] }]);
		expect(arrangeColumns(['guides', 'governance'], 0)).toEqual([{ columns: [['guides', 'governance']] }]);
		expect(arrangeColumns([], 3)).toEqual([]);
	});
});

describe('columns of the layout', () => {
	it('reads a layout without stored columns as dealt left to right in the order, wide tiles aside', () => {
		expect(resolvedColumns(DEFAULT_LAYOUT)).toEqual({ 'getting-started': 0, 'model-checks': 1, questions: 2, governance: 0, 'recent-changes': 1, guides: 2 });
	});

	it('places a tile in a column without moving any other tile out of its column', () => {
		const before = resolvedColumns(DEFAULT_LAYOUT);
		const next = placeTile(DEFAULT_LAYOUT, 'guides', 0, { after: 'governance' });
		expect(next.columns).toEqual({ ...before, guides: 0 });
		expect(next.order.indexOf('guides')).toBe(next.order.indexOf('governance') + 1);
		expect(next.order.filter((id) => id !== 'guides')).toEqual(DEFAULT_LAYOUT.order.filter((id) => id !== 'guides'));
	});

	it('moves a tile before an anchor, keeps the order for a null or unknown anchor and never changes a full-row tile column', () => {
		expect(placeTile(DEFAULT_LAYOUT, 'guides', 1, { before: 'model-checks' }).order.slice(2, 5)).toEqual(['getting-started', 'guides', 'model-checks']);
		expect(placeTile(DEFAULT_LAYOUT, 'guides', 1, null).order).toEqual(DEFAULT_LAYOUT.order);
		expect(placeTile(DEFAULT_LAYOUT, 'guides', 1, { before: 'guides' }).order).toEqual(DEFAULT_LAYOUT.order);
		expect(placeTile(DEFAULT_LAYOUT, 'stages', null, { after: 'guides' }).columns).toEqual(resolvedColumns(DEFAULT_LAYOUT));
	});

	it('is the default layout only with the default order, nothing hidden and the default columns', () => {
		expect(isDefaultLayout(DEFAULT_LAYOUT)).toBe(true);
		expect(isDefaultLayout(placeTile(DEFAULT_LAYOUT, 'guides', 0, null))).toBe(false);
		expect(isDefaultLayout(hideTile(DEFAULT_LAYOUT, 'guides'))).toBe(false);
		expect(isDefaultLayout({ ...DEFAULT_LAYOUT, columns: resolvedColumns(DEFAULT_LAYOUT) })).toBe(true);
	});

	it('keeps stored columns through parse, and drops invalid ones, full-row tiles and non-integers', () => {
		const raw = { version: 1, order: [...TILE_IDS], hidden: [], columns: { guides: 0, stages: 1, questions: -1, governance: 1.5, nonsense: 1, 'model-checks': 2 } };
		expect(parseDashboardLayout(raw).columns).toEqual({ guides: 0, 'model-checks': 2 });
		expect(parseDashboardLayout({ ...raw, columns: 'x' })).toEqual(DEFAULT_LAYOUT);
		expect(parseDashboardLayout({ ...raw, columns: {} })).toEqual(DEFAULT_LAYOUT);
	});
});
