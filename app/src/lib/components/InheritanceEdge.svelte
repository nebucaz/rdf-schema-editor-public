<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface InheritanceEdgeData extends Record<string, unknown> {
		onDelete: () => void;
	}

	export type InheritanceEdgeType = Edge<InheritanceEdgeData, 'inheritance'>;
</script>

<script lang="ts">
	import { BaseEdge, EdgeLabel, useInternalNode, useEdges, useSvelteFlow, type EdgeProps } from '@xyflow/svelte';
	import {
		getFloatingEdgeParams,
		getParallelSmoothStepPath,
		computeParallelOffset,
		computeSelfLoopIndex,
		getSelfLoopPath,
		pointAlongPath,
		percentAtPoint
	} from '$lib/utils/floating-edge';
	import { edgeLabelPositionStore } from '$lib/stores/edge-label-position-store';

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

	// -- Draggable, persisted label position (Sprint 6 Story 021) ---------------------------------
	const { screenToFlowPosition } = useSvelteFlow();
	let storedPercent = $state<number | undefined>(edgeLabelPositionStore.getPercent(id));
	let dragging = $state(false);
	const labelPoint = $derived(
		storedPercent === undefined
			? { x: path[1], y: path[2] }
			: pointAlongPath(path[0], storedPercent, { x: path[1], y: path[2] })
	);

	function handleLabelPointerDown(event: PointerEvent) {
		event.stopPropagation();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragging = true;
	}

	function handleLabelPointerMove(event: PointerEvent) {
		if (!dragging) return;
		const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		const percent = percentAtPoint(path[0], flowPos);
		if (percent !== undefined) storedPercent = percent;
	}

	function handleLabelPointerUp() {
		if (!dragging) return;
		dragging = false;
		edgeLabelPositionStore.setPercent(id, storedPercent);
	}
</script>

<BaseEdge {id} path={path[0]} markerEnd="url(#inheritance-arrow)" />
<EdgeLabel x={labelPoint.x} y={labelPoint.y}>
	<div class="inheritance-label edge-label">
		<!-- `nopan`: see RelationEdge.svelte's identical drag-handle for why this class is required. -->
		<button
			type="button"
			class="drag-handle nopan"
			onpointerdown={handleLabelPointerDown}
			onpointermove={handleLabelPointerMove}
			onpointerup={handleLabelPointerUp}
			aria-label="Drag to reposition label"
			title="Drag to reposition"
		>⠿</button>
		<button class="delete-inheritance" onclick={data.onDelete} aria-label="Delete inheritance edge" title="Delete (is-a)">
			×
		</button>
	</div>
</EdgeLabel>

<style>
	.inheritance-label {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.delete-inheritance {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		min-height: 14px;
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

	.drag-handle {
		cursor: grab;
		color: var(--color-text-muted, #999);
		touch-action: none;
		user-select: none;
		line-height: 1;
		font-size: 10px;
	}

	.drag-handle:active {
		cursor: grabbing;
	}
</style>
