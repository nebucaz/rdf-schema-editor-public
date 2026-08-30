<script module lang="ts">
	import type { Edge } from '@xyflow/svelte';

	/** A Note's optional pointer at the element it annotates (STORY-083) — purely visual, no
	 *  `onDelete`/`onEdit` (unlinking is done from the Note's own menu, not the edge itself). */
	export type NoteLinkEdgeType = Edge<Record<string, never>, 'noteLink'>;
</script>

<script lang="ts">
	import { BaseEdge, useInternalNode, type EdgeProps } from '@xyflow/svelte';
	import { getFloatingEdgeParams, getParallelSmoothStepPath } from '$lib/utils/floating-edge';

	let { id, source, target }: EdgeProps<NoteLinkEdgeType> = $props();

	const sourceNode = $derived(useInternalNode(source));
	const targetNode = $derived(useInternalNode(target));

	const path = $derived.by(() => {
		if (!sourceNode.current || !targetNode.current) return ['', 0, 0] as const;
		const { sx, sy, tx, ty, sourcePos, targetPos } = getFloatingEdgeParams(sourceNode.current, targetNode.current);
		return getParallelSmoothStepPath({
			sourceX: sx,
			sourceY: sy,
			sourcePosition: sourcePos,
			targetX: tx,
			targetY: ty,
			targetPosition: targetPos,
			bendOffsetX: 0,
			bendOffsetY: 0,
			borderRadius: 8
		});
	});
</script>

<BaseEdge {id} path={path[0]} style="stroke-dasharray: 5 4;" />
