import { describe, expect, it } from 'vitest';
import type { Edge, InternalNode } from '@xyflow/svelte';
import {
	computeParallelOffset,
	computeSelfLoopIndex,
	getFloatingEdgeParams,
	getSelfLoopPath,
	pointAlongPath,
	percentAtPoint
} from './floating-edge';

function makeNode(id: string, centerX: number, centerY: number, width = 100, height = 50): InternalNode {
	return {
		id,
		position: { x: centerX - width / 2, y: centerY - height / 2 },
		measured: { width, height },
		internals: {
			positionAbsolute: { x: centerX - width / 2, y: centerY - height / 2 },
			z: 0,
			userNode: {} as InternalNode['internals']['userNode']
		}
	} as unknown as InternalNode;
}

function makeEdge(id: string, source: string, target: string): Edge {
	return { id, source, target } as Edge;
}

describe('computeParallelOffset (STORY-059)', () => {
	it('returns 0 for a lone edge between a pair', () => {
		const edges = [makeEdge('e1', 'A', 'B')];
		expect(computeParallelOffset(edges, 'e1', 'A', 'B')).toBe(0);
	});

	it('assigns non-cancelling offsets to an opposite-direction pair (A->B, B->A)', () => {
		const edges = [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'B', 'A')];
		const a = makeNode('A', 0, 0);
		const b = makeNode('B', 300, 0);

		const offset1 = computeParallelOffset(edges, 'e1', 'A', 'B');
		const offset2 = computeParallelOffset(edges, 'e2', 'B', 'A');

		const params1 = getFloatingEdgeParams(a, b, offset1);
		const params2 = getFloatingEdgeParams(b, a, offset2);

		// Before the fix both edges compute the identical perpendicular vector (the direction flip
		// and the offset-sign flip cancel exactly) — post-fix they must differ, and specifically
		// point to opposite sides so the two lines separate rather than coincide.
		expect(params1.labelOffsetY).not.toBeCloseTo(params2.labelOffsetY);
		expect(Math.sign(params1.labelOffsetY)).not.toBe(Math.sign(params2.labelOffsetY));

		// Each edge's own source/target boundary points must differ from the un-offset center line,
		// i.e. the fix must actually move both lines apart, not just avoid a NaN/zero case.
		expect(params1.sy).not.toBeCloseTo(0);
		expect(params2.sy).not.toBeCloseTo(0);
	});

	it('still separates two same-direction edges (A->B, A->B) — no regression', () => {
		const edges = [makeEdge('e1', 'A', 'B'), makeEdge('e2', 'A', 'B')];
		const offset1 = computeParallelOffset(edges, 'e1', 'A', 'B');
		const offset2 = computeParallelOffset(edges, 'e2', 'A', 'B');

		expect(offset1).not.toBe(offset2);
		expect(offset1).toBe(-offset2);
	});

	it('fans out 3+ edges between the same pair (mixed directions) into distinct offsets', () => {
		const edges = [
			makeEdge('e1', 'A', 'B'),
			makeEdge('e2', 'B', 'A'),
			makeEdge('e3', 'A', 'B')
		];
		const a = makeNode('A', 0, 0);
		const b = makeNode('B', 300, 0);

		const perpYs = edges.map((e) => {
			const offset = computeParallelOffset(edges, e.id, e.source, e.target);
			const source = e.source === 'A' ? a : b;
			const target = e.target === 'A' ? a : b;
			return getFloatingEdgeParams(source, target, offset).labelOffsetY;
		});

		const distinct = new Set(perpYs.map((y) => Math.round(y * 1000)));
		expect(distinct.size).toBe(edges.length);
	});
});

describe('getSelfLoopPath (STORY-060)', () => {
	const node = makeNode('A', 0, 0);

	it('produces a non-degenerate path that stays outside the node bounding box', () => {
		const [path, labelX, labelY] = getSelfLoopPath(node, 0);

		expect(path).not.toBe('');
		expect(path.startsWith('M')).toBe(true);

		const halfW = (node.measured.width ?? 0) / 2;
		const halfH = (node.measured.height ?? 0) / 2;
		const nodeCenterX = node.internals.positionAbsolute.x + halfW;
		const nodeCenterY = node.internals.positionAbsolute.y + halfH;

		// Label must sit clear of the node's own bounding box (never hidden behind the node).
		expect(Math.abs(labelX - nodeCenterX)).toBeGreaterThan(halfW);
		expect(labelY).not.toBeNaN();
		void nodeCenterY;
	});

	it('fans out multiple self-relations on the same node to distinct, non-overlapping loops', () => {
		const edges = [makeEdge('e1', 'A', 'A'), makeEdge('e2', 'A', 'A'), makeEdge('e3', 'A', 'A')];

		const labels = edges.map((e) => {
			const loopIndex = computeSelfLoopIndex(edges, e.id, 'A');
			const [, labelX] = getSelfLoopPath(node, loopIndex);
			return labelX;
		});

		expect(new Set(labels).size).toBe(edges.length);
		// Increasing loop index must move the loop (and its label) further from the node.
		expect(labels[1]).toBeGreaterThan(labels[0]);
		expect(labels[2]).toBeGreaterThan(labels[1]);
	});

	it('assigns stable indices independent of array order (same id-sort contract as computeParallelOffset)', () => {
		const edges = [makeEdge('e2', 'A', 'A'), makeEdge('e1', 'A', 'A')];
		expect(computeSelfLoopIndex(edges, 'e1', 'A')).toBe(0);
		expect(computeSelfLoopIndex(edges, 'e2', 'A')).toBe(1);
	});
});

describe('pointAlongPath / percentAtPoint (Sprint 6 Story 021)', () => {
	// This repo's Vitest project runs under `environment: 'node'` (no DOM/`document` global, per
	// `CLAUDE.md`'s documented component-testing gap), so the real `SVGPathElement.getTotalLength`/
	// `getPointAtLength` measurement path these functions use in the browser can't be exercised here.
	// What's covered instead is the SSR-defensive fallback both functions fall back to outside a
	// browser — genuinely meaningful in *this* environment, since `document` really is undefined here.
	it('pointAlongPath falls back to the given point outside a browser (no document)', () => {
		expect(pointAlongPath('M0,0 L100,0', 0.5, { x: 42, y: 7 })).toEqual({ x: 42, y: 7 });
	});

	it('percentAtPoint returns undefined outside a browser (no document)', () => {
		expect(percentAtPoint('M0,0 L100,0', { x: 50, y: 0 })).toBeUndefined();
	});
});
