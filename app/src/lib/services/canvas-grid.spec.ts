import { describe, expect, it } from 'vitest';
import {
	GRID_CELL,
	LABELS_MIN_ZOOM,
	cellAt,
	columnLabel,
	gridOrigin,
	labelsVisible,
	formatReadout,
	visibleGrid
} from './canvas-grid';

describe('columnLabel', () => {
	it('runs A…Z, then AA, AB… without bound (Excel-style)', () => {
		expect(columnLabel(0)).toBe('A');
		expect(columnLabel(25)).toBe('Z');
		expect(columnLabel(26)).toBe('AA');
		expect(columnLabel(27)).toBe('AB');
		expect(columnLabel(51)).toBe('AZ');
		expect(columnLabel(52)).toBe('BA');
		expect(columnLabel(701)).toBe('ZZ');
		expect(columnLabel(702)).toBe('AAA');
	});
});

describe('gridOrigin', () => {
	const node = (x: number, y: number, hidden = false) => ({ position: { x, y }, hidden });

	it('is the top-left of the visible nodes, rounded down to a cell multiple', () => {
		const o = gridOrigin([node(950, 700), node(1300, 410), node(1010, 910)]);
		expect(o).toEqual({ x: 800, y: 300 });
	});

	it('rounds negative coordinates down so every node stays inside the grid', () => {
		expect(gridOrigin([node(-10, -10)])).toEqual({ x: -GRID_CELL.width, y: -GRID_CELL.height });
	});

	it('ignores hidden nodes', () => {
		expect(gridOrigin([node(5000, 5000, true), node(850, 650)])).toEqual({ x: 800, y: 600 });
	});

	it('is (0, 0) when no node is visible', () => {
		expect(gridOrigin([])).toEqual({ x: 0, y: 0 });
		expect(gridOrigin([node(900, 900, true)])).toEqual({ x: 0, y: 0 });
	});
});

describe('cellAt', () => {
	const origin = { x: 800, y: 300 };

	it('names the cell as column letter + 1-based row number', () => {
		expect(cellAt({ x: 800, y: 300 }, origin)).toBe('A1');
		expect(cellAt({ x: 1199, y: 599 }, origin)).toBe('A1');
		expect(cellAt({ x: 1200, y: 600 }, origin)).toBe('B2');
		expect(cellAt({ x: 800 + 26 * GRID_CELL.width, y: 300 }, origin)).toBe('AA1');
	});

	it('has no cell left of or above the origin (no negative areas)', () => {
		expect(cellAt({ x: 799, y: 400 }, origin)).toBeNull();
		expect(cellAt({ x: 900, y: 299 }, origin)).toBeNull();
	});
});

describe('labelsVisible', () => {
	it('switches off below zoom 0.4 and on from 0.4 up', () => {
		expect(LABELS_MIN_ZOOM).toBe(0.4);
		expect(labelsVisible(0.39)).toBe(false);
		expect(labelsVisible(0.4)).toBe(true);
		expect(labelsVisible(2)).toBe(true);
	});
});

describe('visibleGrid', () => {
	const origin = { x: 400, y: 300 };

	it('lists the columns and rows that intersect the viewport, with screen positions', () => {
		const g = visibleGrid({ x: 0, y: 0, zoom: 1 }, 1000, 700, origin);
		expect(g.columns.map((c) => c.label)).toEqual(['A', 'B']);
		expect(g.columns[0]).toMatchObject({ x: 400, size: 400 });
		expect(g.rows.map((r) => r.label)).toEqual(['1', '2']);
		expect(g.rows[1]).toMatchObject({ y: 600, size: 300 });
	});

	it('follows pan and zoom', () => {
		const g = visibleGrid({ x: -800, y: -600, zoom: 2 }, 1000, 700, origin);
		// flow x visible: 400 … 900, y: 300 … 650 → columns A,B (400-800, 800-1200), rows 1,2
		expect(g.columns[0]).toMatchObject({ label: 'A', x: 0, size: 800 });
		expect(g.rows[0]).toMatchObject({ label: '1', y: 0, size: 600 });
	});

	it('has no columns or rows left of or above the origin (no negative areas)', () => {
		const g = visibleGrid({ x: 600, y: 500, zoom: 1 }, 1000, 700, origin);
		expect(g.columns[0].label).toBe('A');
		expect(g.columns[0].x).toBe(1000);
		expect(g.columns).toHaveLength(1);
		expect(g.origin).toEqual({ x: 1000, y: 800 });
	});

	it('returns nothing when the grid would be too dense to read', () => {
		const g = visibleGrid({ x: 0, y: 0, zoom: 0.01 }, 1000, 700, origin);
		expect(g.columns).toEqual([]);
		expect(g.rows).toEqual([]);
	});
});

describe('formatReadout', () => {
	const origin = { x: 800, y: 300 };

	it('shows cell, rounded flow coordinates and zoom percentage', () => {
		expect(formatReadout(1.25, { x: 1240.4, y: 380.6 }, origin)).toBe('B1 · x 1240 y 381 · 125%');
		expect(formatReadout(1, { x: 800 + 2 * 400 + 5, y: 300 + 3 * 300 + 5 }, origin)).toBe('C4 · x 1605 y 1205 · 100%');
	});

	it('omits the cell outside the grid', () => {
		expect(formatReadout(0.5, { x: 100, y: 100 }, origin)).toBe('x 100 y 100 · 50%');
	});

	it('shows only the zoom when the pointer is not over the canvas', () => {
		expect(formatReadout(2.5, null, origin)).toBe('250%');
	});
});
