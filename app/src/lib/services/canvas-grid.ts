/**
 * Orientation-grid math for the ERD canvas (canvas-navigation Story 001): a fixed flow-space cell
 * size, spreadsheet-style unbounded column labels (`A…Z, AA, AB…`) and 1-based row numbers. The
 * grid's origin is the top-left of the visible nodes' bounding box, so no cell ever has a negative
 * index — anything left of or above the origin simply has no cell. Pure, no canvas/DOM access.
 */

export const GRID_CELL = { width: 400, height: 300 };
/** Column/row labels are hidden below this zoom; the grid lines stay. */
export const LABELS_MIN_ZOOM = 0.4;

interface Point {
	x: number;
	y: number;
}

/** 0 → `A`, 25 → `Z`, 26 → `AA`, 702 → `AAA` (bijective base-26, like a spreadsheet). */
export function columnLabel(index: number): string {
	let label = '';
	let n = index + 1;
	while (n > 0) {
		const rem = (n - 1) % 26;
		label = String.fromCharCode(65 + rem) + label;
		n = Math.floor((n - 1) / 26);
	}
	return label;
}

/** Top-left of the visible nodes' bounding box, rounded down to a cell multiple; `(0, 0)` with none. */
export function gridOrigin(nodes: { position: Point; hidden?: boolean }[]): Point {
	const visible = nodes.filter((n) => !n.hidden);
	if (visible.length === 0) return { x: 0, y: 0 };
	const minX = Math.min(...visible.map((n) => n.position.x));
	const minY = Math.min(...visible.map((n) => n.position.y));
	return {
		x: Math.floor(minX / GRID_CELL.width) * GRID_CELL.width,
		y: Math.floor(minY / GRID_CELL.height) * GRID_CELL.height
	};
}

/** Cell reference (e.g. `C4`) for a flow-space point, or `null` left of / above the origin. */
export function cellAt(point: Point, origin: Point): string | null {
	const dx = point.x - origin.x;
	const dy = point.y - origin.y;
	if (dx < 0 || dy < 0) return null;
	return `${columnLabel(Math.floor(dx / GRID_CELL.width))}${Math.floor(dy / GRID_CELL.height) + 1}`;
}

export function labelsVisible(zoom: number): boolean {
	return zoom >= LABELS_MIN_ZOOM;
}

export interface GridLine {
	index: number;
	label: string;
	/** Screen-space start (x for columns, y for rows) and extent of this cell strip. */
	x: number;
	y: number;
	size: number;
}

export interface VisibleGrid {
	/** Screen position of the grid origin. */
	origin: Point;
	columns: GridLine[];
	rows: GridLine[];
}

/** Below this on-screen cell width/height (px) the grid is too dense to be useful and is omitted. */
const MIN_CELL_SCREEN_PX = 8;

/**
 * Columns and rows of the grid that intersect the viewport, in screen space, for the overlay to
 * draw. Strips start at the origin — nothing exists left of or above it.
 */
export function visibleGrid(
	viewport: { x: number; y: number; zoom: number },
	canvasWidth: number,
	canvasHeight: number,
	origin: Point
): VisibleGrid {
	const { zoom } = viewport;
	const screenOrigin = { x: origin.x * zoom + viewport.x, y: origin.y * zoom + viewport.y };
	const empty = { origin: screenOrigin, columns: [], rows: [] };
	if (GRID_CELL.width * zoom < MIN_CELL_SCREEN_PX || GRID_CELL.height * zoom < MIN_CELL_SCREEN_PX) return empty;

	const strips = (
		cell: number,
		originFlow: number,
		pan: number,
		extent: number,
		label: (i: number) => string,
		axis: 'x' | 'y'
	): GridLine[] => {
		const first = Math.max(0, Math.floor((-pan / zoom - originFlow) / cell));
		const last = Math.floor(((extent - pan) / zoom - originFlow) / cell);
		const lines: GridLine[] = [];
		for (let i = first; i <= last; i++) {
			const start = (originFlow + i * cell) * zoom + pan;
			lines.push({
				index: i,
				label: label(i),
				x: axis === 'x' ? start : 0,
				y: axis === 'y' ? start : 0,
				size: cell * zoom
			});
		}
		return lines;
	};

	return {
		origin: screenOrigin,
		columns: strips(GRID_CELL.width, origin.x, viewport.x, canvasWidth, columnLabel, 'x'),
		rows: strips(GRID_CELL.height, origin.y, viewport.y, canvasHeight, (i) => String(i + 1), 'y')
	};
}

/** Status-bar text: `C4 · x 1240 y 380 · 125%`; cell omitted outside the grid, pointer omitted when absent. */
export function formatReadout(zoom: number, pointer: Point | null, origin: Point): string {
	const zoomText = `${Math.round(zoom * 100)}%`;
	if (!pointer) return zoomText;
	const cell = cellAt(pointer, origin);
	const coords = `x ${Math.round(pointer.x)} y ${Math.round(pointer.y)}`;
	return [cell, coords, zoomText].filter(Boolean).join(' · ');
}
