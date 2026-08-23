<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface RelationEdgeData extends Record<string, unknown> {
		name: string;
		required: boolean;
		repeatable: boolean;
		onEdit: () => void;
		onDelete: () => void;
	}

	export type RelationEdgeType = Edge<RelationEdgeData, 'relation'>;
</script>

<script lang="ts">
	import { BaseEdge, EdgeLabel, useInternalNode, useEdges, type EdgeProps } from '@xyflow/svelte';
	import { getFloatingEdgeParams, getParallelSmoothStepPath, computeParallelOffset } from '$lib/utils/floating-edge';

	let { id, source, target, data: rawData }: EdgeProps<RelationEdgeType> = $props();

	// `data` is typed optional on the base Edge (not all edges carry data), but every relation
	// edge this app creates always sets it — see `makeRelationEdgeData` in the editor page.
	const data = rawData as RelationEdgeData;

	// An edge's source/target node ids never change after creation (edges are deleted and
	// recreated, never rewired), so re-deriving on every render isn't needed, but wrapping in
	// $derived keeps svelte-check happy about referencing the `source`/`target` props.
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

<BaseEdge {id} path={path[0]} markerEnd="url(#relation-arrow)" />
<EdgeLabel x={path[1]} y={path[2]}>
	<div class="relation-label">
		<span
			class="name"
			title={`${data.required ? 'Required (!)' : 'Optional (?)'}${data.repeatable ? ', repeatable ([]) — multiple values allowed' : ', single-valued'}`}
		>{data.name}{data.required ? '!' : '?'}{data.repeatable ? '[]' : ''}</span>
		<button class="icon-button" onclick={data.onEdit} aria-label={`Edit relation ${data.name}`} title="Edit">
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
		</button>
		<button class="icon-button" onclick={data.onDelete} aria-label={`Delete relation ${data.name}`} title="Delete">
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
		</button>
	</div>
</EdgeLabel>

<style>
	.relation-label {
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

	.icon-button {
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

	.icon-button:hover {
		background: var(--color-hover, rgba(0, 0, 0, 0.08));
		color: var(--color-text, #333);
	}
</style>
