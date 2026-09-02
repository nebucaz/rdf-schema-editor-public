<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export interface RelationEdgeData extends Record<string, unknown> {
		name: string;
		required: boolean;
		repeatable: boolean;
		/** 'generic' for a shared relation with no rdfs:domain/rdfs:range (STORY-051/052, defaults
		 *  to 'specific' for attributed-link edges, which never offer the generic choice). */
		kind: 'specific' | 'generic';
		/** The underlying `owl:ObjectProperty` IRI (STORY-054) — kept separate from the Svelte Flow
		 *  edge `id` because a *generic* relation's property IRI is shared across every source class
		 *  reusing it, so it alone can't serve as a unique per-edge id (two edges reusing the same
		 *  generic relation from different source classes would otherwise collide on `id`). */
		propIri: string;
		onEdit: () => void;
		onDelete: () => void;
	}

	export type RelationEdgeType = Edge<RelationEdgeData, 'relation'>;
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

<BaseEdge {id} path={path[0]} markerEnd="url(#relation-arrow)" />
<EdgeLabel x={labelPoint.x} y={labelPoint.y}>
	<div class="relation-label edge-label">
		<!-- `nopan`: without it, @xyflow/svelte's pane-pan gesture recognizer (a d3-zoom filter that
			 excludes only `event.target.closest('.nopan')`, not stopPropagation) treats this drag as
			 panning the whole canvas instead of moving just the label. -->
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
			title={`${data.kind === 'generic' ? 'Generic relation (shared, no rdfs:domain/rdfs:range) — ' : ''}${data.required ? 'Required (!)' : 'Optional (?)'}${data.repeatable ? ', repeatable ([]) — multiple values allowed' : ', single-valued'}`}
		>{data.kind === 'generic' ? '⇄ ' : ''}{data.name}{data.required ? '!' : '?'}{data.repeatable ? '[]' : ''}</span>
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
