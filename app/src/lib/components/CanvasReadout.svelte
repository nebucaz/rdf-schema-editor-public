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
		left: 0.5rem;
		bottom: 0.5rem;
		z-index: 5;
		pointer-events: none;
		padding: 0.15rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		background: color-mix(in srgb, var(--color-surface, #fff) 85%, transparent);
		color: var(--color-text-muted, currentColor);
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
	}
</style>
