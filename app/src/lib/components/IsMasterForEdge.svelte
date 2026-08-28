<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface IsMasterForEdgeData extends Record<string, unknown> {
		/** Display text for the edge label — defaults to "isMasterFor". Generalized individual→class
		 *  relations (data-catalog Story 017) reuse this same component with their own relation
		 *  name here, instead of `isMasterFor`'s fixed "isMasterFor" label. */
		label?: string;
		onDelete: () => void;
	}

	export type IsMasterForEdgeType = Edge<IsMasterForEdgeData, 'isMasterFor'>;
</script>

<script lang="ts">
	import { BaseEdge, EdgeLabel, useInternalNode, useEdges, type EdgeProps } from '@xyflow/svelte';
	import {
		getFloatingEdgeParams,
		getParallelSmoothStepPath,
		computeParallelOffset,
		computeSelfLoopIndex,
		getSelfLoopPath
	} from '$lib/utils/floating-edge';

	let { id, source, target, data: rawData }: EdgeProps<IsMasterForEdgeType> = $props();

	// See RelationEdge.svelte: `data` is optional on the base Edge type, but every isMasterFor edge
	// this app creates always sets it — see `createIsMasterForEdge` in the editor page.
	const data = rawData as IsMasterForEdgeData;

	const sourceNode = $derived(useInternalNode(source));
	const targetNode = $derived(useInternalNode(target));
	const edges = useEdges();

	const path = $derived.by(() => {
		if (!sourceNode.current || !targetNode.current) return ['', 0, 0] as const;
		if (source === target) {
			const loopIndex = computeSelfLoopIndex(edges.current, id, source);
			return getSelfLoopPath(sourceNode.current, loopIndex);
		}
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

<BaseEdge {id} path={path[0]} markerEnd="url(#ismasterfor-arrow)" />
<EdgeLabel x={path[1]} y={path[2]}>
	<div class="ismasterfor-label">
		<span
			class="name"
			title={data.label ?? 'isMasterFor — this SystemOfWork is the authoritative source for this class'}
			>{data.label ?? 'isMasterFor'}</span
		>
		<button class="delete-ismasterfor" onclick={data.onDelete} aria-label="Delete relation" title="Delete relation">
			×
		</button>
	</div>
</EdgeLabel>

<style>
	.ismasterfor-label {
		display: flex;
		align-items: center;
		gap: 3px;
		background: var(--color-bg-secondary, #fff);
		border: 1px solid var(--color-border, #ccc);
		border-radius: 4px;
		padding: 1px 4px;
		font-size: 10px;
		color: var(--color-text, #333);
		white-space: nowrap;
	}

	.delete-ismasterfor {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 3px;
		background: transparent;
		color: var(--color-text-muted, #666);
		border: none;
		cursor: pointer;
	}

	.delete-ismasterfor:hover {
		background: var(--color-hover, rgba(0, 0, 0, 0.08));
		color: var(--color-error);
	}
</style>
