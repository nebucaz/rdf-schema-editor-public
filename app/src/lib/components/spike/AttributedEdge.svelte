<script lang="ts">
	import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/svelte';

	let { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, markerEnd }: EdgeProps =
		$props();

	const path = $derived(
		getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
	);
</script>

<BaseEdge {id} path={path[0]} {markerEnd} />
<g transform={`translate(${path[1]}, ${path[2]}) rotate(45)`}>
	<rect
		x="-6"
		y="-6"
		width="12"
		height="12"
		class="association-marker"
		aria-label="attributed relationship"
	/>
</g>

<style>
	.association-marker {
		fill: var(--color-bg-secondary, #fff);
		stroke: var(--color-accent, #007acc);
		stroke-width: 1.5px;
	}
</style>
