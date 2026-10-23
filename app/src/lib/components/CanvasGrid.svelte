<script lang="ts">
	import { labelsVisible, visibleGrid } from '$lib/services/canvas-grid';

	interface Props {
		viewport: { x: number; y: number; zoom: number };
		width: number;
		height: number;
		/** Flow-space grid origin (`gridOrigin` of the visible nodes). */
		origin: { x: number; y: number };
	}

	let { viewport, width, height, origin }: Props = $props();

	const grid = $derived(visibleGrid(viewport, width, height, origin));
	const showLabels = $derived(labelsVisible(viewport.zoom));
	/** Labels are pinned to the top/left edge of the canvas, not to the strip itself. */
	const LABEL_INSET = 14;
</script>

<!-- Purely visual orientation aid: `pointer-events: none` keeps nodes and the pane interactive. -->
<svg class="canvas-grid" aria-hidden="true" {width} {height}>
	{#each grid.columns as col (col.index)}
		<line x1={col.x} y1={Math.max(0, grid.origin.y)} x2={col.x} y2={height} />
	{/each}
	{#each grid.rows as row (row.index)}
		<line x1={Math.max(0, grid.origin.x)} y1={row.y} x2={width} y2={row.y} />
	{/each}
	{#if showLabels}
		{#each grid.columns as col (col.index)}
			<text class="label" x={col.x + col.size / 2} y={LABEL_INSET} text-anchor="middle">{col.label}</text>
		{/each}
		{#each grid.rows as row (row.index)}
			<text class="label" x={LABEL_INSET / 2 + 2} y={row.y + row.size / 2} dominant-baseline="middle">{row.label}</text>
		{/each}
	{/if}
</svg>

<style>
	.canvas-grid {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		color: var(--color-text-muted, currentColor);
	}
	line {
		stroke: currentColor;
		stroke-opacity: 0.25;
		stroke-width: 1;
		stroke-dasharray: 4 4;
	}
	.label {
		fill: currentColor;
		fill-opacity: 0.7;
		font-size: 12px;
		font-weight: 600;
	}
</style>
