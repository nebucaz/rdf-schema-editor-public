import type { Edge, InternalNode } from '@xyflow/svelte';
import {
	computeParallelOffset,
	computeSelfLoopIndex,
	getFloatingEdgeParams,
	getParallelSmoothStepPath,
	getSelfLoopPath
} from '$lib/utils/floating-edge';
import type { TextMeasurer } from '$lib/utils/erd-svg';
import type { Cardinality, ErdAttribute, ErdModel } from './erd-model';

/**
 * Pure layout for the Export ERD renderers (STORY-154): sizes each symbol per notation with an
 * injected `TextMeasurer`, keeps the user's stored workspace positions, resolves overlaps with
 * minimal (monotone right/down) displacement, places Chen/UML auxiliary symbols collision-free, and
 * computes edge endpoints with `floating-edge.ts`'s boundary/parallel/self-loop math.
 */

export type Notation = 'crows-foot' | 'uml' | 'chen';

export interface Point {
	x: number;
	y: number;
}

export interface Rect extends Point {
	width: number;
	height: number;
}

export type SymbolKind = 'diamond' | 'ellipse' | 'isa';

export interface PlacedSymbol {
	id: string;
	kind: SymbolKind;
	rect: Rect;
	label: string;
	/** Model iri this symbol stands for (relation / association class / owning entity for attributes). */
	ref: string;
	ownerIri?: string;
	attribute?: ErdAttribute;
}

export type PlacedEdgeKind =
	| 'relation'
	| 'relationLeg'
	| 'associationLink'
	| 'associationClass'
	| 'inheritance'
	| 'attribute';

export interface PlacedEdge {
	id: string;
	kind: PlacedEdgeKind;
	/** Model iri (relation / link iri); absent for inheritance and attribute edges. */
	ref?: string;
	sourceIri: string;
	targetIri: string;
	name?: string;
	cardinality?: Cardinality;
	/** Exact `min..max` text (UML label) when it differs from the cardinality symbol. */
	multiplicity?: string;
	/** Chen relation legs: which end of the relation this leg attaches to. */
	end?: 'source' | 'target';
	from: Point;
	to: Point;
	label: Point;
	/** Orthogonal (90°) polyline `from → … → to`, matching the workbench's step edges; absent for
	 *  straight legs and self-loops. */
	route?: Point[];
	loop?: { path: string; labelX: number; labelY: number };
}

export interface ErdLayout {
	/** Entity (and external-class) boxes keyed by iri. */
	entities: Record<string, Rect>;
	symbols: PlacedSymbol[];
	edges: PlacedEdge[];
	bounds: Rect;
}

export interface LayoutOptions {
	minGap?: number;
}

const FONT = 12;
const HEADER_FONT = 14;
const PAD_X = 12;
const HEADER_H = 28;
const ROW_H = 18;
const BOTTOM_PAD = 8;
const MIN_ENTITY_W = 120;
const EXTERNAL_H = 32;
const CHEN_ENTITY_H = 40;
const CHEN_MIN_W = 90;
const CHEN_GAP = 80;
const ELLIPSE_H = 30;
const DIAMOND_H = 44;
const UML_DIAMOND = 22;
const ISA = { width: 40, height: 32 };
const SYMBOL_GAP = 6;
const MARGIN = 24;
const SEARCH_STEP = 12;
const MAX_SEARCH = 800;

/** Row text for an attribute — shared with the renderers so box sizing and drawing agree. */
export function attributeText(a: ErdAttribute, notation: Notation): string {
	const inherited = a.inheritedFrom ? ` (from ${a.inheritedFrom.className})` : '';
	if (notation === 'chen') return `${a.name}${inherited}`;
	if (notation === 'uml') {
		const mult = a.repeatable ? (a.required ? '[1..*]' : '[0..*]') : a.required ? '' : '[0..1]';
		return `${a.name} : ${a.datatype}${mult}${inherited}`;
	}
	return `${a.required ? '*' : 'o'} ${a.name} : ${a.datatype}${a.repeatable ? '[]' : ''}${inherited}`;
}

const overlaps = (a: Rect, b: Rect, gap = 0): boolean =>
	a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

function unit(dx: number, dy: number, fallback: Point = { x: 0, y: 1 }): Point {
	const len = Math.hypot(dx, dy);
	return len === 0 ? fallback : { x: dx / len, y: dy / len };
}

function fakeNode(r: Rect): InternalNode {
	return {
		measured: { width: r.width, height: r.height },
		internals: { positionAbsolute: { x: r.x, y: r.y } }
	} as unknown as InternalNode;
}

/** Boundary point of a diamond/triangle-ish (L1-ball) or ellipse symbol toward `toward`. */
function symbolBoundary(s: PlacedSymbol, toward: Point): Point {
	const c = center(s.rect);
	const dx = toward.x - c.x;
	const dy = toward.y - c.y;
	if (dx === 0 && dy === 0) return c;
	const hw = s.rect.width / 2;
	const hh = s.rect.height / 2;
	const k =
		s.kind === 'ellipse'
			? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
			: 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
	return { x: c.x + dx * k, y: c.y + dy * k };
}

/** Entity-side endpoint of an edge toward another rect, via `floating-edge.ts`. */
function entitySide(entity: Rect, other: Rect, offset = 0): Point {
	const p = getFloatingEdgeParams(fakeNode(entity), fakeNode(other), offset);
	return { x: p.sx, y: p.sy };
}

interface Box {
	iri: string;
	width: number;
	height: number;
	external: boolean;
}

function sizeBoxes(model: ErdModel, notation: Notation, measure: TextMeasurer): Box[] {
	const entityBoxes = model.entities.map((e): Box => {
		if (notation === 'chen') {
			return {
				iri: e.iri,
				width: Math.max(CHEN_MIN_W, measure(e.name, HEADER_FONT, 'bold') + 2 * PAD_X),
				height: CHEN_ENTITY_H,
				external: false
			};
		}
		const rows = e.attributes.map((a) => measure(attributeText(a, notation), FONT));
		const width = Math.max(MIN_ENTITY_W, measure(e.name, HEADER_FONT, 'bold') + 2 * PAD_X, ...rows.map((w) => w + 2 * PAD_X));
		return { iri: e.iri, width, height: HEADER_H + e.attributes.length * ROW_H + BOTTOM_PAD, external: false };
	});
	const externalBoxes = model.externals.map(
		(x): Box => ({
			iri: x.iri,
			width: Math.max(MIN_ENTITY_W, measure(x.prefixedName, FONT) + 2 * PAD_X),
			height: EXTERNAL_H,
			external: true
		})
	);
	return [...entityBoxes, ...externalBoxes];
}

function placeBoxes(boxes: Box[], positions: Record<string, Point>, gap: number): Record<string, Rect> {
	const rects: Record<string, Rect> = {};
	const missing = boxes.filter((b) => !positions[b.iri]).sort((a, b) => a.iri.localeCompare(b.iri));
	const cellW = Math.max(0, ...boxes.map((b) => b.width)) + gap * 2;
	const cellH = Math.max(0, ...boxes.map((b) => b.height)) + gap * 2;
	const cols = Math.max(1, Math.ceil(Math.sqrt(missing.length)));
	missing.forEach((b, i) => {
		rects[b.iri] = { x: (i % cols) * cellW, y: Math.floor(i / cols) * cellH, width: b.width, height: b.height };
	});
	for (const b of boxes) {
		const p = positions[b.iri];
		if (p) rects[b.iri] = { x: p.x, y: p.y, width: b.width, height: b.height };
	}

	// Resolve overlaps: process in (y, x, iri) order and only ever push the later box right or down,
	// whichever is the smaller push — monotone, so it terminates, and untouched when nothing overlaps.
	const order = boxes
		.map((b) => b.iri)
		.sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x || a.localeCompare(b));
	for (let pass = 0; pass < 2000; pass++) {
		let changed = false;
		for (let i = 0; i < order.length; i++) {
			for (let j = i + 1; j < order.length; j++) {
				const a = rects[order[i]];
				const b = rects[order[j]];
				if (!overlaps(a, b, gap)) continue;
				const pushX = a.x + a.width + gap - b.x;
				const pushY = a.y + a.height + gap - b.y;
				if (pushX <= pushY) b.x += pushX;
				else b.y += pushY;
				changed = true;
			}
		}
		if (!changed) break;
	}
	return rects;
}

/** First collision-free rect along `candidates(k)`; falls back to the last candidate. */
function findFree(
	size: { width: number; height: number },
	candidates: (k: number) => Point,
	obstacles: Rect[]
): Rect {
	let rect: Rect = { ...candidates(0), ...size };
	for (let k = 0; k < MAX_SEARCH; k++) {
		const c = candidates(k);
		rect = { x: c.x - size.width / 2, y: c.y - size.height / 2, ...size };
		if (!obstacles.some((o) => overlaps(rect, o, SYMBOL_GAP))) return rect;
	}
	return rect;
}

/** Candidates alternating either side of `origin` along unit vector `perp`: 0, +1, -1, +2, … */
const alternating = (origin: Point, perp: Point) => (k: number): Point => {
	const n = Math.ceil(k / 2) * SEARCH_STEP * (k % 2 === 1 ? 1 : -1);
	return { x: origin.x + perp.x * n, y: origin.y + perp.y * n };
};

/** Candidates marching outward from `origin` along `dir`. */
const outward = (origin: Point, dir: Point) => (k: number): Point => ({
	x: origin.x + dir.x * k * SEARCH_STEP,
	y: origin.y + dir.y * k * SEARCH_STEP
});

function placeSymbols(
	model: ErdModel,
	notation: Notation,
	rects: Record<string, Rect>,
	measure: TextMeasurer
): PlacedSymbol[] {
	if (notation === 'crows-foot') return [];
	const symbols: PlacedSymbol[] = [];
	const obstacles: Rect[] = Object.values(rects);
	const add = (s: PlacedSymbol) => {
		symbols.push(s);
		obstacles.push(s.rect);
	};

	if (notation === 'chen') {
		for (const r of model.relations) {
			const s = rects[r.sourceIri];
			const t = rects[r.targetIri];
			const size = { width: Math.max(70, measure(r.name, 11) + 40), height: DIAMOND_H };
			let rect: Rect;
			if (r.sourceIri === r.targetIri) {
				const origin = { x: s.x + s.width + size.width / 2 + 40, y: center(s).y };
				rect = findFree(size, alternating(origin, { x: 0, y: 1 }), obstacles);
			} else {
				const cs = center(s);
				const ct = center(t);
				const origin = { x: (cs.x + ct.x) / 2, y: (cs.y + ct.y) / 2 };
				const d = unit(ct.x - cs.x, ct.y - cs.y);
				rect = findFree(size, alternating(origin, { x: -d.y, y: d.x }), obstacles);
			}
			add({ id: `relation:${r.iri}:${r.sourceIri}>${r.targetIri}`, kind: 'diamond', rect, label: r.name, ref: r.iri });
		}
	}

	if (notation === 'uml') {
		const byAssoc = new Map<string, string[]>();
		for (const l of model.associationLinks) {
			byAssoc.set(l.associationIri, [...(byAssoc.get(l.associationIri) ?? []), l.targetIri]);
		}
		for (const [assocIri, targets] of [...byAssoc].sort(([a], [b]) => a.localeCompare(b))) {
			const cs = targets.map((t) => center(rects[t]));
			const origin = {
				x: cs.reduce((sum, c) => sum + c.x, 0) / cs.length,
				y: cs.reduce((sum, c) => sum + c.y, 0) / cs.length
			};
			const ca = center(rects[assocIri]);
			const d = unit(ca.x - origin.x, ca.y - origin.y);
			const rect = findFree({ width: UML_DIAMOND, height: UML_DIAMOND }, alternating(origin, { x: -d.y, y: d.x }), obstacles);
			add({ id: `association:${assocIri}`, kind: 'diamond', rect, label: '', ref: assocIri });
		}
	}

	if (notation === 'chen') {
		for (const inh of model.inheritances) {
			const cs = center(rects[inh.subIri]);
			const cp = center(rects[inh.superIri]);
			const origin = { x: (cs.x + cp.x) / 2, y: (cs.y + cp.y) / 2 };
			const d = unit(cp.x - cs.x, cp.y - cs.y);
			const rect = findFree(ISA, alternating(origin, { x: -d.y, y: d.x }), obstacles);
			add({ id: `isa:${inh.subIri}>${inh.superIri}`, kind: 'isa', rect, label: 'ISA', ref: inh.subIri });
		}
		for (const e of model.entities) {
			const box = rects[e.iri];
			const c = center(box);
			e.attributes.forEach((a, i) => {
				const label = attributeText(a, 'chen');
				const size = { width: measure(label, FONT) + 28, height: ELLIPSE_H };
				const angle = -Math.PI / 2 + (i * 2 * Math.PI) / e.attributes.length;
				const dir = { x: Math.cos(angle), y: Math.sin(angle) };
				const exit = Math.min(
					Math.abs(dir.x) < 1e-9 ? Infinity : box.width / 2 / Math.abs(dir.x),
					Math.abs(dir.y) < 1e-9 ? Infinity : box.height / 2 / Math.abs(dir.y)
				);
				const start = exit + Math.max(size.width, size.height) / 2 + SYMBOL_GAP;
				const origin = { x: c.x + dir.x * start, y: c.y + dir.y * start };
				const rect = findFree(size, outward(origin, dir), obstacles);
				add({
					id: `attribute:${e.iri}:${i}`,
					kind: 'ellipse',
					rect,
					label,
					ref: e.iri,
					ownerIri: e.iri,
					attribute: a
				});
			});
		}
	}
	return symbols;
}

/** Vertices of a radius-0 step path (`M x,y L x,y …`); falls back to the straight segment. */
function parseStepPath(path: string, from: Point, to: Point): Point[] {
	const nums = path.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g)?.map(Number) ?? [];
	const pts: Point[] = [];
	for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
	return pts.length >= 2 ? pts : [from, to];
}

function buildEdges(model: ErdModel, notation: Notation, rects: Record<string, Rect>, symbols: PlacedSymbol[]): PlacedEdge[] {
	const edges: PlacedEdge[] = [];
	const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

	interface Direct {
		id: string;
		kind: PlacedEdgeKind;
		ref?: string;
		name?: string;
		cardinality?: Cardinality;
		multiplicity?: string;
		sourceIri: string;
		targetIri: string;
	}
	const direct: Direct[] = [];
	for (const r of model.relations) {
		if (notation === 'chen') continue;
		direct.push({ id: `relation:${r.iri}:${r.sourceIri}>${r.targetIri}`, kind: 'relation', ref: r.iri, name: r.name, cardinality: r.cardinality, multiplicity: r.multiplicity, sourceIri: r.sourceIri, targetIri: r.targetIri });
	}
	for (const l of model.associationLinks) {
		if (notation === 'uml') continue;
		direct.push({ id: `associationLink:${l.iri}:${l.associationIri}>${l.targetIri}`, kind: 'associationLink', ref: l.iri, name: l.name, cardinality: l.cardinality, multiplicity: l.multiplicity, sourceIri: l.associationIri, targetIri: l.targetIri });
	}
	for (const i of model.inheritances) {
		if (notation === 'chen') continue;
		direct.push({ id: `inheritance:${i.subIri}>${i.superIri}`, kind: 'inheritance', sourceIri: i.subIri, targetIri: i.superIri });
	}
	const flowEdges: Edge[] = direct.map((d) => ({ id: d.id, source: d.sourceIri, target: d.targetIri }) as Edge);
	for (const d of direct) {
		const s = rects[d.sourceIri];
		const t = rects[d.targetIri];
		if (d.sourceIri === d.targetIri) {
			const idx = computeSelfLoopIndex(flowEdges, d.id, d.sourceIri);
			const [path, labelX, labelY] = getSelfLoopPath(fakeNode(s), idx);
			edges.push({
				...d,
				from: { x: s.x + s.width, y: s.y + s.height * 0.35 },
				to: { x: s.x + s.width, y: s.y + s.height * 0.65 },
				label: { x: labelX, y: labelY },
				loop: { path, labelX, labelY }
			});
			continue;
		}
		const offset = computeParallelOffset(flowEdges, d.id, d.sourceIri, d.targetIri);
		const p = getFloatingEdgeParams(fakeNode(s), fakeNode(t), offset);
		const from = { x: p.sx, y: p.sy };
		const to = { x: p.tx, y: p.ty };
		const [stepPath, labelX, labelY] = getParallelSmoothStepPath({
			sourceX: p.sx,
			sourceY: p.sy,
			sourcePosition: p.sourcePos,
			targetX: p.tx,
			targetY: p.ty,
			targetPosition: p.targetPos,
			bendOffsetX: p.labelOffsetX,
			bendOffsetY: p.labelOffsetY,
			borderRadius: 0
		});
		edges.push({ ...d, from, to, label: { x: labelX, y: labelY }, route: parseStepPath(stepPath, from, to) });
	}

	const sym = (id: string) => symbols.find((s) => s.id === id)!;
	const leg = (id: string, kind: PlacedEdgeKind, entityIri: string, s: PlacedSymbol, extra: Partial<PlacedEdge>, offset = 0, symbolIsSource = false) => {
		const entityPoint = entitySide(rects[entityIri], s.rect, offset);
		const symbolPoint = symbolBoundary(s, entityPoint);
		const from = symbolIsSource ? symbolPoint : entityPoint;
		const to = symbolIsSource ? entityPoint : symbolPoint;
		edges.push({ id, kind, sourceIri: entityIri, targetIri: entityIri, ...extra, from, to, label: mid(from, to) });
	};

	if (notation === 'chen') {
		for (const r of model.relations) {
			const s = sym(`relation:${r.iri}:${r.sourceIri}>${r.targetIri}`);
			const self = r.sourceIri === r.targetIri;
			const common = { ref: r.iri, name: r.name, sourceIri: r.sourceIri, targetIri: r.targetIri };
			leg(`${s.id}#source`, 'relationLeg', r.sourceIri, s, { ...common, end: 'source' }, self ? -12 : 0);
			leg(`${s.id}#target`, 'relationLeg', r.targetIri, s, { ...common, end: 'target', cardinality: r.cardinality }, self ? 12 : 0, true);
		}
		for (const i of model.inheritances) {
			const s = sym(`isa:${i.subIri}>${i.superIri}`);
			const common = { sourceIri: i.subIri, targetIri: i.superIri };
			leg(`${s.id}#sub`, 'inheritance', i.subIri, s, common);
			leg(`${s.id}#super`, 'inheritance', i.superIri, s, common, 0, true);
		}
		for (const s of symbols.filter((x) => x.kind === 'ellipse')) {
			leg(s.id, 'attribute', s.ownerIri!, s, { sourceIri: s.ownerIri!, targetIri: s.ownerIri! });
		}
	}

	if (notation === 'uml') {
		for (const l of model.associationLinks) {
			const s = sym(`association:${l.associationIri}`);
			leg(`associationLink:${l.iri}:${l.associationIri}>${l.targetIri}`, 'associationLink', l.targetIri, s, {
				ref: l.iri,
				name: l.name,
				cardinality: l.cardinality,
				multiplicity: l.multiplicity,
				sourceIri: l.associationIri,
				targetIri: l.targetIri
			}, 0, true);
		}
		for (const s of symbols.filter((x) => x.id.startsWith('association:'))) {
			leg(`associationClass:${s.ref}`, 'associationClass', s.ref, s, { ref: s.ref, sourceIri: s.ref, targetIri: s.ref }, 0, true);
		}
	}
	return edges;
}

function computeBounds(rects: Rect[], edges: PlacedEdge[]): Rect {
	const all = [...rects];
	for (const e of edges) {
		for (const q of e.route ?? []) all.push({ x: q.x, y: q.y, width: 0, height: 0 });
		if (e.loop) {
			all.push({ x: e.from.x, y: e.from.y - 110, width: e.loop.labelX - e.from.x + 80, height: e.to.y - e.from.y + 220 });
		}
	}
	if (all.length === 0) return { x: 0, y: 0, width: 2 * MARGIN + 100, height: 2 * MARGIN + 60 };
	const minX = Math.min(...all.map((r) => r.x));
	const minY = Math.min(...all.map((r) => r.y));
	const maxX = Math.max(...all.map((r) => r.x + r.width));
	const maxY = Math.max(...all.map((r) => r.y + r.height));
	return { x: minX - MARGIN, y: minY - MARGIN, width: maxX - minX + 2 * MARGIN, height: maxY - minY + 2 * MARGIN };
}

export function layoutErd(
	model: ErdModel,
	positions: Record<string, Point>,
	notation: Notation,
	measurer: TextMeasurer,
	options: LayoutOptions = {}
): ErdLayout {
	const minGap = options.minGap ?? MARGIN;
	const gap = notation === 'chen' ? Math.max(minGap, CHEN_GAP) : minGap;
	const boxes = sizeBoxes(model, notation, measurer);
	const entities = placeBoxes(boxes, positions, gap);
	const symbols = placeSymbols(model, notation, entities, measurer);
	const edges = buildEdges(model, notation, entities, symbols);
	const bounds = computeBounds([...Object.values(entities), ...symbols.map((s) => s.rect)], edges);
	return { entities, symbols, edges, bounds };
}
