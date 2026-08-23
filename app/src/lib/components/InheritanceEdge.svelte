<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface InheritanceEdgeData extends Record<string, unknown> {
		onDelete: () => void;
	}

	export type InheritanceEdgeType = Edge<InheritanceEdgeData, 'inheritance'>;
</script>

<script lang="ts">
	import { BaseEdge, EdgeLabel, useInternalNode, useEdges, type EdgeProps } from '@xyflow/svelte';
	import { getFloatingEdgeParams, getParallelSmoothStepPath, computeParallelOffset } from '$lib/utils/floating-edge';

	let { id, source, target, data: rawData }: EdgeProps<InheritanceEdgeType> = $props();

	// See RelationEdge.svelte: `data` is optional on the base Edge type, but every inheritance edge
	// this app creates always sets it — see `createInheritanceEdge` in the editor page.
	const data = rawData as InheritanceEdgeData;

	// See RelationEdge.svelte: source/target node ids never change after edge creation, but
	// wrapping in $derived keeps svelte-check happy about referencing the props.
	const sourceNode = $derived(useInternalNode(source));
	const targetNode = $derived(useInternalNode(target));
	const edges = useEdges();

	const path = $derived.by(() => {
		if (!sourceNode.current || !targetNode.current) return ['', 0, 0] as const;
		const offset = computeParallelOffset(edges.current, id, source, target);
		const { sx, sy, tx, ty, sourcePos, targetPos, labelOffsetX, labelOffsetY } = getFloatingEdgeParams(
			sourceNode.current,
			targetNode.current,
			offset
		);
		return getParallelSmoothStepPath({
			sourceX: sx,
			sourceY: sy,
			sourcePosition: sourcePos,
			targetX: tx,
			targetY: ty,
			targetPosition: targetPos,
			bendOffsetX: labelOffsetX,
			bendOffsetY: labelOffsetY,
			borderRadius: 0
		});
	});
</script>

<BaseEdge {id} path={path[0]} markerEnd="url(#inheritance-arrow)" />
<EdgeLabel x={path[1]} y={path[2]}>
	<button class="delete-inheritance" onclick={data.onDelete} aria-label="Delete inheritance edge" title="Delete (is-a)">
		×
	</button>
</EdgeLabel>

<style>
	.delete-inheritance {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--color-bg-secondary, #fff);
		border: 1px solid var(--color-border, #ccc);
		color: var(--color-text-muted, #666);
		font-size: 10px;
		line-height: 1;
	}

	.delete-inheritance:hover {
		background: var(--color-hover);
		color: var(--color-error);
	}
</style>
