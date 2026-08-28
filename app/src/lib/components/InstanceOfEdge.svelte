<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	export type InstanceOfEdgeType = Edge<Record<string, unknown>, 'instanceOf'>;
</script>

<script lang="ts">
	import { BaseEdge, useInternalNode, useEdges, type EdgeProps } from '@xyflow/svelte';
	import {
		getFloatingEdgeParams,
		getParallelSmoothStepPath,
		computeParallelOffset,
		computeSelfLoopIndex,
		getSelfLoopPath
	} from '$lib/utils/floating-edge';

	let { id, source, target }: EdgeProps<InstanceOfEdgeType> = $props();

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

<!-- Derived from IndividualNodeSpec.classIri, not a stored triple — nothing to edit or delete, so
	unlike every other edge type there's no EdgeLabel/delete button here, just a muted dashed line
	marking "this individual is an instance of this class". -->
<BaseEdge
	{id}
	path={path[0]}
	markerEnd="url(#instanceof-arrow)"
	style="stroke: var(--color-text-muted, #999); stroke-dasharray: 4 3; opacity: 0.6;"
	interactionWidth={0}
/>
