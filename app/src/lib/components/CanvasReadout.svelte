<script lang="ts">
	interface Props {
		/** Pre-formatted status text (`formatReadout`). */
		text: string;
	}

	let { text }: Props = $props();
</script>

<div class="canvas-readout" data-testid="canvas-readout" aria-hidden="true">{text}</div>

<style>
	.canvas-readout {
		position: absolute;
		/* Top left: Svelte Flow's <Controls /> owns the bottom-left corner, <MiniMap /> the bottom-right,
		   CanvasSearch the top-right. */
		left: 0.5rem;
		top: 0.5rem;
		white-space: nowrap;
		z-index: 5;
		pointer-events: none;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		background: color-mix(in srgb, var(--color-surface) 85%, transparent);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
	}
</style>
