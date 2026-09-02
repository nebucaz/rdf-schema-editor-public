<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface AttributedLinkEdgeData extends Record<string, unknown> {
		propName: string;
		required: boolean;
		repeatable: boolean;
		onEdit: () => void;
		onDelete: () => void;
	}

	export type AttributedLinkEdgeType = Edge<AttributedLinkEdgeData, 'attributedLink'>;
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

	let { id, source, target, markerEnd, data: rawData }: EdgeProps<AttributedLinkEdgeType> = $props();

	// See RelationEdge.svelte: `data` is optional on the base Edge type, but every attributed-link
	// edge this app creates always sets it — see `handleCreateAssociation` in the editor page.
	const data = rawData as AttributedLinkEdgeData;

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
			? { x: path[1], y: path[2] - 16 }
			: pointAlongPath(path[0], storedPercent, { x: path[1], y: path[2] - 16 })
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

<BaseEdge {id} path={path[0]} {markerEnd} />
<g transform={`translate(${path[1]}, ${path[2]}) rotate(45)`}>
	<rect x="-6" y="-6" width="12" height="12" class="association-marker" aria-label="attributed relationship link" />
</g>
<EdgeLabel x={labelPoint.x} y={labelPoint.y}>
	<div class="link-label edge-label">
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
			title={`${data.required ? 'Required (!)' : 'Optional (?)'}${data.repeatable ? ', repeatable ([]) — multiple values allowed' : ', single-valued'}`}
		>{data.propName}{data.required ? '!' : '?'}{data.repeatable ? '[]' : ''}</span>
		<button class="icon-button" onclick={data.onEdit} aria-label={`Edit link ${data.propName}`} title="Edit">
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
		</button>
		<button class="icon-button" onclick={data.onDelete} aria-label={`Delete link ${data.propName}`} title="Delete">
			<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
		</button>
	</div>
</EdgeLabel>

<style>
	.association-marker {
		fill: var(--color-bg-secondary, #fff);
		stroke: var(--color-accent, #007acc);
		stroke-width: 1.5px;
	}

	.link-label {
		display: flex;
		align-items: center;
		gap: 3px;
		background: var(--color-bg-secondary, #fff);
		border: 1px solid var(--color-border, #ccc);
		border-radius: 4px;
		padding: 1px 4px;
		font-size: 10px;
		color: var(--color-text-muted, #666);
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
