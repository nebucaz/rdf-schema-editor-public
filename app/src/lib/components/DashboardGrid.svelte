<script lang="ts">
	/** The arrangeable tile grid of the Ontology dashboard (spec/ontology-dashboard STORY-470). It knows nothing about
	 *  storage: every change is reported through `onchange` with the new layout. Each narrow tile belongs to a column and the
	 *  columns stack independently: a tile is dropped on another tile or on a column (even an empty one) and the other tiles stay
	 *  where they are. Only a tile whose handle is held can be dragged; the arrow keys on the handle are the keyboard path
	 *  (up/down within the column, left/right to the next column). A tile can be hidden, and Reset layout restores the default. */
	import { tick, type Snippet } from 'svelte';
	import {
		WIDE_TILES,
		arrangeColumns,
		hideTile,
		isDefaultLayout,
		moveTile,
		placeTile,
		resetLayout,
		resolvedColumns,
		showTile,
		type Anchor,
		type DashboardLayout,
		type TileId
	} from '#lib/services/dashboard-layout.js';

	interface Props {
		layout: DashboardLayout;
		titles: Record<TileId, string>;
		tile: Snippet<[TileId]>;
		onchange?: (layout: DashboardLayout) => void;
		/** No controls and no drag: the shared read-only page. */
		readonly?: boolean;
		/** Fixes the number of columns instead of following the width of the grid (tests, or a host that knows better). */
		columns?: number;
	}

	let { layout, titles, tile, onchange = () => {}, readonly = false, columns: fixedColumns }: Props = $props();

	const visible = $derived(layout.order.filter((id) => !layout.hidden.includes(id)));
	const hiddenTiles = $derived(layout.order.filter((id) => layout.hidden.includes(id)));

	/** Width of the grid; the number of columns follows it (a column is at least `COLUMN_REM` wide). */
	let gridWidth = $state(0);
	const COLUMN_REM = 22;
	const GAP_REM = 1;
	const columnCount = $derived.by(() => {
		if (fixedColumns !== undefined) return Math.max(1, fixedColumns);
		const rem = typeof document === 'undefined' ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
		return Math.max(1, Math.floor((gridWidth / rem + GAP_REM) / (COLUMN_REM + GAP_REM)));
	});
	const segments = $derived(arrangeColumns(visible, columnCount, resolvedColumns(layout)));

	interface Spot {
		/** Index of the segment in `segments`. */
		segment: number;
		/** Column of a narrow tile; `null` for a full-row tile. */
		column: number | null;
		/** Place in its column (or among the visible tiles for a full-row tile). */
		index: number;
		size: number;
	}
	const spots = $derived.by(() => {
		const found = new Map<TileId, Spot>();
		segments.forEach((segment, n) => {
			if ('wide' in segment) found.set(segment.wide, { segment: n, column: null, index: visible.indexOf(segment.wide), size: visible.length });
			else segment.columns.forEach((stack, c) => stack.forEach((id, index) => found.set(id, { segment: n, column: c, index, size: stack.length })));
		});
		return found;
	});

	let announcement = $state('');
	let dragged = $state<TileId | null>(null);
	/** The tile whose handle is held: only then is the tile draggable, so text selection and links in the body keep working. */
	let armed = $state<TileId | null>(null);
	let dropTarget = $state<TileId | null>(null);
	/** The column being dragged over, as `segment:column`. */
	let dropColumn = $state<string | null>(null);

	function emit(next: DashboardLayout) {
		onchange(next);
	}

	/** A tile that changes column is a new element, so focus goes back to its handle. */
	function refocus(id: TileId) {
		void tick().then(() => document.querySelector<HTMLElement>(`[data-handle="${id}"]`)?.focus());
	}

	/** The anchor that puts a tile at the end of column `column` of segment `n`; in an empty column, after the last tile of the run. */
	function endOfColumn(n: number, column: number, id: TileId): Anchor {
		const segment = segments[n];
		if (!segment || 'wide' in segment) return null;
		const mine = segment.columns[column].filter((t) => t !== id);
		if (mine.length > 0) return { after: mine[mine.length - 1] };
		const run = segment.columns.flat().filter((t) => t !== id);
		const last = run.sort((a, b) => layout.order.indexOf(a) - layout.order.indexOf(b)).at(-1);
		return last ? { after: last } : null;
	}

	/** Moves `id` one visible place; used for full-row tiles, hidden neighbours are stepped over so the press always changes what is on screen. */
	function step(id: TileId, direction: -1 | 1) {
		const i = visible.indexOf(id);
		const neighbour = visible[i + direction];
		if (neighbour === undefined) return;
		emit(moveTile(layout, id, layout.order.indexOf(neighbour)));
		announcement = `${titles[id]} moved to position ${i + direction + 1} of ${visible.length}.`;
		refocus(id);
	}

	/** The handle is also the keyboard path. */
	function onHandleKey(event: KeyboardEvent, id: TileId) {
		const keys: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
		const move = keys[event.key];
		if (!move) return;
		event.preventDefault();
		const spot = spots.get(id);
		if (!spot) return;
		if (spot.column === null) {
			if (move[1] !== 0) step(id, move[1] as -1 | 1);
			return;
		}
		const segment = segments[spot.segment];
		if (!('columns' in segment)) return;
		if (move[1] !== 0) {
			const stack = segment.columns[spot.column];
			const neighbour = stack[spot.index + move[1]];
			if (neighbour === undefined) return;
			emit(placeTile(layout, id, spot.column, move[1] < 0 ? { before: neighbour } : { after: neighbour }));
			announcement = `${titles[id]} moved ${move[1] < 0 ? 'up' : 'down'} to position ${spot.index + move[1] + 1} of ${spot.size}.`;
		} else {
			const column = spot.column + move[0];
			if (column < 0 || column >= columnCount) return;
			const target = segment.columns[column];
			const anchor: Anchor = target.length === 0 ? endOfColumn(spot.segment, column, id) : spot.index < target.length ? { before: target[spot.index] } : { after: target[target.length - 1] };
			emit(placeTile(layout, id, column, anchor));
			announcement = `${titles[id]} moved to column ${column + 1} of ${columnCount}.`;
		}
		refocus(id);
	}

	function onDragStart(event: DragEvent, id: TileId) {
		if (armed !== id) {
			event.preventDefault();
			return;
		}
		dragged = id;
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', id);
		}
	}

	function onDragOver(event: DragEvent, id: TileId) {
		if (!dragged) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = id;
		dropColumn = null;
	}

	/** Dropped on a tile: it takes that tile's column and the dragged tile goes before it, or after it when dragged down within its own column. */
	function onDrop(event: DragEvent, id: TileId) {
		event.preventDefault();
		event.stopPropagation();
		const from = dragged;
		dragged = dropTarget = dropColumn = null;
		if (!from || from === id) return;
		const target = spots.get(id);
		const source = spots.get(from);
		if (!target) return;
		const below = source !== undefined && source.segment === target.segment && source.column === target.column && layout.order.indexOf(from) < layout.order.indexOf(id);
		const anchor: Anchor = below || (source?.column === null && layout.order.indexOf(from) < layout.order.indexOf(id)) ? { after: id } : { before: id };
		const wideSource = WIDE_TILES.includes(from);
		emit(placeTile(layout, from, wideSource ? null : target.column ?? resolvedColumns(layout)[from] ?? 0, anchor));
		announcement = `${titles[from]} moved${target.column === null || wideSource ? '' : ` to column ${target.column + 1} of ${columnCount}`}.`;
	}

	function onColumnDragOver(event: DragEvent, n: number, column: number) {
		if (!dragged) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropColumn = `${n}:${column}`;
		dropTarget = null;
	}

	/** Dropped on a column rather than a tile: the tile goes to the end of that column and nothing else moves. */
	function onColumnDrop(event: DragEvent, n: number, column: number) {
		event.preventDefault();
		const from = dragged;
		dragged = dropTarget = dropColumn = null;
		if (!from) return;
		emit(placeTile(layout, from, WIDE_TILES.includes(from) ? null : column, endOfColumn(n, column, from)));
		announcement = `${titles[from]} moved to column ${column + 1} of ${columnCount}.`;
	}

	function onDragEnd() {
		dragged = dropTarget = dropColumn = armed = null;
	}
</script>

<div class="dashboard" data-testid="dashboard-grid">
	{#if !readonly}
		<div class="toolbar">
			<button type="button" class="reset" onclick={() => emit(resetLayout())} disabled={isDefaultLayout(layout)}>Reset layout</button>
			{#if hiddenTiles.length > 0}
				<details class="hidden-tiles" data-testid="hidden-tiles">
					<summary>Hidden tiles ({hiddenTiles.length})</summary>
					<ul>
						{#each hiddenTiles as id (id)}
							<li>
								{titles[id]}
								<button type="button" onclick={() => emit(showTile(layout, id))} aria-label={`Show ${titles[id]}`}>Show</button>
							</li>
						{/each}
					</ul>
				</details>
			{/if}
		</div>
	{/if}

	<div class="grid" bind:clientWidth={gridWidth}>
		{#each segments as segment, n (n)}
			{#if 'wide' in segment}
				{@render tileCard(segment.wide)}
			{:else}
				<div class="columns" style:grid-template-columns={`repeat(${segment.columns.length}, minmax(0, 1fr))`}>
					{#each segment.columns as stack, c (c)}
						<div
							class="stack"
							class:drop-column={dropColumn === `${n}:${c}`}
							class:receiving={dragged !== null}
							data-testid={`column-${n}-${c}`}
							role="group"
							ondragover={readonly ? undefined : (e) => onColumnDragOver(e, n, c)}
							ondrop={readonly ? undefined : (e) => onColumnDrop(e, n, c)}
						>
							{#each stack as id (id)}
								{@render tileCard(id)}
							{/each}
						</div>
					{/each}
				</div>
			{/if}
		{/each}
	</div>

	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</div>

{#snippet tileCard(id: TileId)}
	{@const spot = spots.get(id)}
	<section
		class="tile"
		class:wide={WIDE_TILES.includes(id)}
		class:dragging={dragged === id}
		class:drop-target={dropTarget === id && dragged !== id}
		data-testid={`tile-${id}`}
		aria-labelledby={`tile-title-${id}`}
		draggable={!readonly && armed === id}
		ondragstart={readonly ? undefined : (e) => onDragStart(e, id)}
		ondragover={readonly ? undefined : (e) => onDragOver(e, id)}
		ondrop={readonly ? undefined : (e) => onDrop(e, id)}
		ondragend={readonly ? undefined : onDragEnd}
	>
		<header>
			<h2 id={`tile-title-${id}`}>{titles[id]}</h2>
			{#if !readonly}
				<span class="controls">
					<button type="button" class="icon" aria-label={`Hide ${titles[id]}`} title="Hide" onclick={() => emit(hideTile(layout, id))}>
						<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
							<circle cx="12" cy="12" r="3" />
							<line x1="3" y1="3" x2="21" y2="21" />
						</svg>
					</button>
					<button type="button" class="handle" data-handle={id} aria-label={`Move ${titles[id]} (${spot?.column == null ? '' : `column ${spot.column + 1} of ${columnCount}, `}position ${(spot?.index ?? 0) + 1} of ${spot?.size ?? visible.length}); drag, or use the arrow keys`} title="Drag to move" onpointerdown={() => (armed = id)} onpointerup={() => (armed = null)} onpointercancel={() => (armed = null)} onkeydown={(e) => onHandleKey(e, id)}>⠿</button>
				</span>
			{/if}
		</header>
		<div class="body">{@render tile(id)}</div>
	</section>
{/snippet}

<style>
	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.toolbar {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		font-size: 0.85rem;
	}
	.grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	/* Each column stacks its own tiles, so a tall tile never stretches the tiles beside it. */
	.columns {
		display: grid;
		gap: 1rem;
	}
	.stack {
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}
	.tile {
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
		padding: 0.6rem 0.8rem;
		min-width: 0;
	}
	.tile.dragging {
		opacity: 0.5;
	}
	.tile.drop-target {
		outline: 2px dashed var(--color-accent);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	h2 {
		margin: 0;
		font-size: 1rem;
	}
	.stack.receiving {
		min-height: 4rem;
	}
	.stack.drop-column {
		outline: 2px dashed var(--color-accent);
		outline-offset: 2px;
		border-radius: 8px;
	}
	.icon {
		display: inline-flex;
		align-items: center;
	}
	.handle {
		cursor: grab;
		touch-action: none;
	}
	.controls {
		display: flex;
		gap: 0.2rem;
	}
	button {
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.8rem;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--color-hover);
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	ul {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
