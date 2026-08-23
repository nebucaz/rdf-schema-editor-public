import { Position, getSmoothStepPath, type Edge, type InternalNode } from '@xyflow/svelte';

/**
 * Finds the point where the line from `intersectionNode`'s center through `targetPoint` crosses
 * `intersectionNode`'s rectangle boundary. Used to attach edges anywhere along a node's edge (not
 * just at a fixed handle position) — see the "floating edges" pattern:
 * https://reactflow.dev/examples/edges/floating-edges
 *
 * `targetPoint` only needs to be a point (usually the other node's center, or — for parallel-edge
 * offsetting, see `getFloatingEdgeParams` — a point offset from it), not a full node.
 */
function getNodeIntersection(intersectionNode: InternalNode, targetPoint: { x: number; y: number }) {
	const w = (intersectionNode.measured.width ?? 0) / 2;
	const h = (intersectionNode.measured.height ?? 0) / 2;
	const intersectionNodePosition = intersectionNode.internals.positionAbsolute;

	const x2 = intersectionNodePosition.x + w;
	const y2 = intersectionNodePosition.y + h;
	const x1 = targetPoint.x;
	const y1 = targetPoint.y;

	const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
	const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
	const a = 1 / (Math.abs(xx1) + Math.abs(yy1) || 1);
	const xx3 = a * xx1;
	const yy3 = a * yy1;
	const x = w * (xx3 + yy3) + x2;
	const y = h * (-xx3 + yy3) + y2;

	return { x, y };
}

function getEdgePosition(node: InternalNode, intersectionPoint: { x: number; y: number }): Position {
	const n = node.internals.positionAbsolute;
	const nx = Math.round(n.x);
	const ny = Math.round(n.y);
	const px = Math.round(intersectionPoint.x);
	const py = Math.round(intersectionPoint.y);
	const width = node.measured.width ?? 0;
	const height = node.measured.height ?? 0;

	if (px <= nx + 1) return Position.Left;
	if (px >= nx + width - 1) return Position.Right;
	if (py <= ny + 1) return Position.Top;
	if (py >= ny + height - 1) return Position.Bottom;
	return Position.Top;
}

function nodeCenter(node: InternalNode): { x: number; y: number } {
	const pos = node.internals.positionAbsolute;
	return { x: pos.x + (node.measured.width ?? 0) / 2, y: pos.y + (node.measured.height ?? 0) / 2 };
}

/**
 * Computes floating-edge endpoints between two nodes: the exact point on each node's boundary that
 * lies on the line connecting the two node centers, plus the side (Top/Right/Bottom/Left) that
 * point falls on for path routing.
 *
 * `offset` (pixels, issue: overlapping parallel links) shifts the line each endpoint aims at,
 * perpendicular to the source-target axis, by the same amount on both ends — this is what lets two
 * (or more) edges between the *same* pair of nodes fan out into distinct, individually clickable
 * paths instead of being drawn exactly on top of each other. `offset: 0` (the default) reproduces
 * the original single-line behavior.
 */
export function getFloatingEdgeParams(source: InternalNode, target: InternalNode, offset = 0) {
	const sourceCenter = nodeCenter(source);
	const targetCenter = nodeCenter(target);

	let sourceAimPoint = targetCenter;
	let targetAimPoint = sourceCenter;
	let perpX = 0;
	let perpY = 0;

	if (offset !== 0) {
		const dx = targetCenter.x - sourceCenter.x;
		const dy = targetCenter.y - sourceCenter.y;
		const length = Math.hypot(dx, dy) || 1;
		// Unit vector perpendicular to the source→target axis, scaled by `offset` — applied to both
		// aim points the same way so the two resulting boundary-crossing lines stay parallel.
		perpX = (-dy / length) * offset;
		perpY = (dx / length) * offset;
		sourceAimPoint = { x: targetCenter.x + perpX, y: targetCenter.y + perpY };
		targetAimPoint = { x: sourceCenter.x + perpX, y: sourceCenter.y + perpY };
	}

	const sourceIntersectionPoint = getNodeIntersection(source, sourceAimPoint);
	const targetIntersectionPoint = getNodeIntersection(target, targetAimPoint);

	const sourcePos = getEdgePosition(source, sourceIntersectionPoint);
	const targetPos = getEdgePosition(target, targetIntersectionPoint);

	return {
		sx: sourceIntersectionPoint.x,
		sy: sourceIntersectionPoint.y,
		tx: targetIntersectionPoint.x,
		ty: targetIntersectionPoint.y,
		sourcePos,
		targetPos,
		// Same perpendicular vector applied to the endpoints — feed into `getParallelSmoothStepPath`'s
		// `bendOffsetX/Y` so the path's actual *bend point* (not just its label) is forced apart for
		// sibling edges, not merely the label glued on top of an otherwise-still-overlapping line.
		labelOffsetX: perpX,
		labelOffsetY: perpY
	};
}

/**
 * `getSmoothStepPath` (from `@xyflow/svelte`) picks its own bend/label point from `sourcePosition`/
 * `targetPosition` alone — for two nodes stacked mostly vertically (or mostly horizontally), that
 * point barely moves even once the endpoints themselves (`sourceX/Y`, `targetX/Y`) are offset via
 * `getFloatingEdgeParams`' `offset`, so sibling edges between the same node pair still draw
 * (near-)identical paths that visually collapse into one — nudging only the label on top made them
 * *look* separated without the lines actually being separated.
 *
 * This wraps `getSmoothStepPath` in two calls: first to find where it would naturally bend, then
 * again with that point explicitly pushed by `(bendOffsetX, bendOffsetY)` via the `centerX`/`centerY`
 * params — which forces the actual routed path (not just the label) through the offset point, so
 * parallel edges are genuinely distinct, independently clickable lines. `bendOffsetX: 0, bendOffsetY:
 * 0` (single edge, no siblings) skips the second call and reproduces the plain `getSmoothStepPath`
 * result unchanged.
 */
export function getParallelSmoothStepPath(params: {
	sourceX: number;
	sourceY: number;
	sourcePosition: Position;
	targetX: number;
	targetY: number;
	targetPosition: Position;
	bendOffsetX: number;
	bendOffsetY: number;
	borderRadius?: number;
}): readonly [path: string, labelX: number, labelY: number] {
	const {
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
		bendOffsetX,
		bendOffsetY,
		borderRadius = 0
	} = params;

	const base = { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius };

	if (bendOffsetX === 0 && bendOffsetY === 0) {
		const [path, labelX, labelY] = getSmoothStepPath(base);
		return [path, labelX, labelY];
	}

	const [, naturalCenterX, naturalCenterY] = getSmoothStepPath(base);
	const [path, labelX, labelY] = getSmoothStepPath({
		...base,
		centerX: naturalCenterX + bendOffsetX,
		centerY: naturalCenterY + bendOffsetY
	});
	return [path, labelX, labelY];
}

/** Pixel spacing between two parallel edges sharing the same pair of nodes — see
 *  `computeParallelOffset`. Wide enough to separate labels/click targets, narrow enough that edges
 *  still visually belong to the same node pair. */
const PARALLEL_EDGE_SPACING = 36;

/**
 * The perpendicular offset (see `getFloatingEdgeParams`) this edge should render at, so that when
 * two or more edges (of any kind — relation/attributedLink/inheritance all share the same visual
 * space) connect the same *unordered* pair of nodes, they fan out into distinct, individually
 * clickable paths instead of overlapping (issue: overlapping parallel links).
 *
 * Grouping is by unordered pair so `A->B` and `B->A` edges are offset apart from each other too —
 * they'd otherwise draw the exact same line. Ordering within a group is by edge id, which is stable
 * and available without any extra bookkeeping, so the same edge always lands at the same offset
 * across re-renders regardless of array order.
 */
export function computeParallelOffset(edges: Edge[], id: string, source: string, target: string): number {
	const pairKey = [source, target].sort().join('|');
	const group = edges
		.filter((e) => [e.source, e.target].sort().join('|') === pairKey)
		.map((e) => e.id)
		.sort();
	const index = group.indexOf(id);
	if (index === -1 || group.length <= 1) return 0;
	return (index - (group.length - 1) / 2) * PARALLEL_EDGE_SPACING;
}
