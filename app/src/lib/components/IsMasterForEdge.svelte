<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface IsMasterForEdgeData extends Record<string, unknown> {
		/** Display text for the edge label — defaults to "isMasterFor". Generalized individual→class
		 *  relations (data-catalog Story 017) reuse this same component with their own relation
		 *  name here, instead of `isMasterFor`'s fixed "isMasterFor" label. */
		label?: string;
		/** Opens the unified relation-edit modal scoped to this edge — lets the user rename/retarget
		 *  the relation itself and author/list/delete assertions against it. The assertions section
		 *  reifies the edge's own ground triple lazily, in the background, the first time it's opened
		 *  (`ensureReifiedStatement`); the modal doesn't wait on that round-trip to open. */
		onEdit: () => void;
		onDelete: () => void;
	}

	export type IsMasterForEdgeType = Edge<IsMasterForEdgeData, 'isMasterFor'>;
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

<BaseEdge {id} path={path[0]} markerEnd="url(#ismasterfor-arrow)" />
<EdgeLabel x={labelPoint.x} y={labelPoint.y}>
	<div class="ismasterfor-label edge-label">
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
		<span
			class="name"
			title={data.label ?? 'isMasterFor — this SystemOfWork is the authoritative source for this class'}
			>{data.label ?? 'isMasterFor'}</span
		>
		<button
			class="icon-button"
			onclick={data.onEdit}
			aria-label={`Edit relation ${data.label ?? 'isMasterFor'}`}
			title="Edit"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
		</button>
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

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		min-height: 14px;
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

	.delete-ismasterfor {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		min-height: 14px;
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

	.drag-handle {
		cursor: grab;
		color: var(--color-text-muted, #999);
		touch-action: none;
		user-select: none;
		line-height: 1;
	}

	.drag-handle:active {
		cursor: grabbing;
	}
</style>
