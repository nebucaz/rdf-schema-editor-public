/** Order and visibility of the Ontology dashboard tiles (spec/ontology-dashboard STORY-467). Pure and immutable: no DOM,
 *  no storage; drag, the move buttons and Reset all go through these functions. */

/** Default order: the full-row tiles (`WIDE_TILES`) first, so they sit above the shared rows. */
export const TILE_IDS = ['stages', 'scheme-health', 'getting-started', 'model-checks', 'questions', 'governance', 'recent-changes', 'guides'] as const;
export type TileId = (typeof TILE_IDS)[number];

/** Tiles whose content (a table or a strip per namespace) needs the whole row; the others share rows. Fixed per tile, not stored. */
export const WIDE_TILES: readonly TileId[] = ['stages', 'scheme-health'];

/** A run of the dashboard: one full-row tile, or the narrow tiles between two full-row tiles in independent columns. */
export type DashboardSegment = { wide: TileId } | { columns: TileId[][] };

/** The columns the default layout deals the narrow tiles into; also how a layout without stored columns is read. */
export const DEFAULT_COLUMN_COUNT = 3;

/** Puts the visible tiles into `columns` stacks. A tile goes to its preferred column (folded into the last one when the window is
 *  narrower); a tile without a preference is dealt left to right. Every run has all `columns` stacks, empty ones included, so a tile
 *  can be dropped into them. A full-row tile ends the run before it and starts a new one after it. */
export function arrangeColumns(visible: readonly TileId[], columns: number, preferred: Partial<Record<TileId, number>> = {}): DashboardSegment[] {
	const count = Math.max(1, Math.floor(columns));
	const segments: DashboardSegment[] = [];
	let run: TileId[] = [];
	const flush = () => {
		if (run.length === 0) return;
		const stacks: TileId[][] = Array.from({ length: count }, () => []);
		run.forEach((id, i) => stacks[preferred[id] === undefined ? i % count : Math.min(preferred[id]!, count - 1)].push(id));
		segments.push({ columns: stacks });
		run = [];
	};
	for (const id of visible) {
		if (WIDE_TILES.includes(id)) {
			flush();
			segments.push({ wide: id });
		} else run.push(id);
	}
	flush();
	return segments;
}

export interface DashboardLayout {
	version: 1;
	/** Every known tile exactly once. */
	order: TileId[];
	/** Tiles the user hid; they keep their place in `order`. */
	hidden: TileId[];
	/** The column each narrow tile prefers (0 is the left one). Absent in a layout saved before columns existed; see `resolvedColumns`. */
	columns?: Partial<Record<TileId, number>>;
}

const MAX_COLUMN = 9;

export const DEFAULT_LAYOUT: DashboardLayout = Object.freeze({ version: 1, order: [...TILE_IDS], hidden: [] }) as DashboardLayout;

const isTileId = (value: unknown): value is TileId => typeof value === 'string' && (TILE_IDS as readonly string[]).includes(value);

export function resetLayout(): DashboardLayout {
	return { version: 1, order: [...TILE_IDS], hidden: [] };
}

/** Moves `id` to `toIndex` (clamped) in the order. An id that is not in the order leaves the layout unchanged. */
export function moveTile(layout: DashboardLayout, id: TileId, toIndex: number): DashboardLayout {
	const from = layout.order.indexOf(id);
	if (from < 0) return layout;
	const order = layout.order.filter((t) => t !== id);
	order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, id);
	return { ...layout, order, hidden: [...layout.hidden] };
}

/** The preferred column of every narrow tile: the stored one, else the tile is dealt left to right in `order` like a default layout. */
export function resolvedColumns(layout: DashboardLayout): Partial<Record<TileId, number>> {
	const result: Partial<Record<TileId, number>> = {};
	let dealt = 0;
	for (const id of layout.order) {
		if (WIDE_TILES.includes(id)) continue;
		result[id] = layout.columns?.[id] ?? dealt % DEFAULT_COLUMN_COUNT;
		dealt += 1;
	}
	return result;
}

/** True when nothing is hidden, the order is the default one and every tile is in its default column. */
export function isDefaultLayout(layout: DashboardLayout): boolean {
	if (layout.hidden.length > 0 || !layout.order.every((id, i) => id === TILE_IDS[i])) return false;
	const defaults = resolvedColumns(DEFAULT_LAYOUT);
	const mine = resolvedColumns(layout);
	return TILE_IDS.every((id) => mine[id] === defaults[id]);
}

/** Where `id` goes in the order: right before or right after another tile, or (`null`) where it is now. */
export type Anchor = { before: TileId } | { after: TileId } | null;

/** Puts a tile in `column` (`null` for a full-row tile, which has none) at `anchor`, leaving every other tile in its own column, so
 *  adding a tile to a column or taking one out never shifts the others. */
export function placeTile(layout: DashboardLayout, id: TileId, column: number | null, anchor: Anchor): DashboardLayout {
	const columns = column === null ? resolvedColumns(layout) : { ...resolvedColumns(layout), [id]: column };
	let order = [...layout.order];
	if (anchor) {
		const rest = layout.order.filter((t) => t !== id);
		const target = 'before' in anchor ? anchor.before : anchor.after;
		const at = rest.indexOf(target);
		if (at >= 0 && target !== id) {
			rest.splice('before' in anchor ? at : at + 1, 0, id);
			order = rest;
		}
	}
	return { ...layout, order, hidden: [...layout.hidden], columns };
}

export function moveEarlier(layout: DashboardLayout, id: TileId): DashboardLayout {
	const i = layout.order.indexOf(id);
	return i <= 0 ? layout : moveTile(layout, id, i - 1);
}

export function moveLater(layout: DashboardLayout, id: TileId): DashboardLayout {
	const i = layout.order.indexOf(id);
	return i < 0 || i === layout.order.length - 1 ? layout : moveTile(layout, id, i + 1);
}

export function hideTile(layout: DashboardLayout, id: TileId): DashboardLayout {
	return layout.hidden.includes(id) ? layout : { ...layout, order: [...layout.order], hidden: [...layout.hidden, id] };
}

export function showTile(layout: DashboardLayout, id: TileId): DashboardLayout {
	return { ...layout, order: [...layout.order], hidden: layout.hidden.filter((t) => t !== id) };
}

/** Repairs a stored layout against the tiles the app knows now: unknown and repeated ids go, a tile added since is placed
 *  right after the tile that precedes it in the default order, so no tile is ever lost. */
export function normalizeLayout(stored: { order: readonly unknown[]; hidden: readonly unknown[]; columns?: Record<string, unknown> }): DashboardLayout {
	const order: TileId[] = [];
	for (const id of stored.order) if (isTileId(id) && !order.includes(id)) order.push(id);
	for (const [i, id] of TILE_IDS.entries()) {
		if (order.includes(id)) continue;
		const previous = TILE_IDS.slice(0, i).reverse().find((t) => order.includes(t));
		order.splice(previous ? order.indexOf(previous) + 1 : 0, 0, id);
	}
	const hidden: TileId[] = [];
	for (const id of stored.hidden) if (isTileId(id) && !hidden.includes(id)) hidden.push(id);
	const columns: Partial<Record<TileId, number>> = {};
	for (const [id, column] of Object.entries(stored.columns ?? {})) {
		if (isTileId(id) && !WIDE_TILES.includes(id) && Number.isInteger(column) && (column as number) >= 0 && (column as number) <= MAX_COLUMN) columns[id] = column as number;
	}
	return Object.keys(columns).length > 0 ? { version: 1, order, hidden, columns } : { version: 1, order, hidden };
}

/** Reads stored JSON (a string, or already-parsed `unknown`). Anything malformed gives the default layout; it never throws. */
export function parseDashboardLayout(raw: unknown): DashboardLayout {
	try {
		const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
		if (typeof value !== 'object' || value === null || Array.isArray(value)) return resetLayout();
		const { version, order, hidden, columns } = value as Record<string, unknown>;
		if (version !== 1 || !Array.isArray(order) || !Array.isArray(hidden)) return resetLayout();
		if (!order.every((id) => typeof id === 'string') || !hidden.every((id) => typeof id === 'string')) return resetLayout();
		return normalizeLayout({ order, hidden, columns: typeof columns === 'object' && columns !== null && !Array.isArray(columns) ? (columns as Record<string, unknown>) : undefined });
	} catch {
		return resetLayout();
	}
}
