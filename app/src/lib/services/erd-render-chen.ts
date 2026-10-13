import { el, type ErdTheme } from '$lib/utils/erd-svg';
import type { Cardinality, ErdEntity, ErdModel } from './erd-model';
import type { ErdLayout, PlacedEdge, PlacedSymbol, Point, Rect } from './erd-layout';
import {
	diamondPoints,
	edgeShape,
	externalBox,
	headerFill,
	lineEl,
	nearEnd,
	num,
	polygonEl,
	textEl,
	type RenderParts
} from './erd-render-common';

/** Chen renderer — symbol specs in `spec/export-erd/notation-reference.md` §3. */

/** `1`/`N` label from the max, double line (total participation) from the min. */
export function chenCardinality(c: Cardinality): { label: '1' | 'N'; total: boolean } {
	return { label: c === '0..1' || c === '1' ? '1' : 'N', total: c === '1' || c === '1..*' };
}

/** Two parallel lines 2px either side of the centre line — the double line of total participation. */
export function doubleLine(from: Point, to: Point, theme: ErdTheme, extra: Record<string, string | number | undefined>): string[] {
	const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const nx = -(to.y - from.y) / len;
	const ny = (to.x - from.x) / len;
	return [-2, 2].map((d) =>
		lineEl({ x: from.x + nx * d, y: from.y + ny * d }, { x: to.x + nx * d, y: to.y + ny * d }, theme, { 'stroke-width': 1.2, ...extra })
	);
}

/** Closed triangle (apex up) in `r`, rotated about its centre so the apex faces `toward`. */
function isaTriangle(s: PlacedSymbol, toward: Point, theme: ErdTheme): string {
	const r = s.rect;
	const cx = r.x + r.width / 2;
	const cy = r.y + r.height / 2;
	const angle = (Math.atan2(toward.y - cy, toward.x - cx) * 180) / Math.PI + 90;
	return polygonEl(
		[
			{ x: cx, y: r.y },
			{ x: r.x + r.width, y: r.y + r.height },
			{ x: r.x, y: r.y + r.height }
		],
		{ 'data-kind': 'isa', 'data-ref': s.ref, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5, transform: `rotate(${num(angle)} ${num(cx)} ${num(cy)})` }
	);
}

function entityBox(e: ErdEntity, r: Rect, theme: ErdTheme): string {
	const hdr = headerFill(theme, e);
	const parts = [
		el('rect', { 'data-iri': e.iri, x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height), fill: hdr.fill, stroke: theme.stroke, 'stroke-width': 1.5 })
	];
	if (e.isAssociationClass) {
		parts.push(polygonEl(diamondPoints(r), { 'data-kind': 'association-class-diamond', fill: 'none', stroke: theme.stroke, 'stroke-width': 1.2 }));
	}
	parts.push(textEl(r.x + r.width / 2, r.y + r.height / 2, e.name, { size: 14, weight: 'bold', anchor: 'middle', fill: hdr.text }));
	return el('g', {}, parts);
}

function attributeEllipse(s: PlacedSymbol, theme: ErdTheme): string {
	const a = s.attribute!;
	const r = s.rect;
	const cx = r.x + r.width / 2;
	const cy = r.y + r.height / 2;
	const dash = a.inheritedFrom ? '2 3' : a.required ? undefined : '6 4';
	const ellipse = (rx: number, ry: number, kind: string) =>
		el('ellipse', {
			'data-kind': kind,
			'data-required': String(a.required),
			'data-inherited': a.inheritedFrom ? 'true' : undefined,
			cx: num(cx),
			cy: num(cy),
			rx: num(rx),
			ry: num(ry),
			fill: theme.surface,
			stroke: theme.stroke,
			'stroke-width': 1.5,
			'stroke-dasharray': dash
		});
	const parts = [ellipse(r.width / 2, r.height / 2, 'attribute')];
	if (a.repeatable) parts.push(ellipse(r.width / 2 - 3, r.height / 2 - 3, 'attribute-inner'));
	parts.push(textEl(cx, cy, s.label, { size: 12, anchor: 'middle', fill: a.inheritedFrom ? theme.mutedText : theme.text, italic: a.inheritedFrom !== undefined }));
	return el('g', {}, parts);
}

function edgeMarks(e: PlacedEdge, theme: ErdTheme): string {
	const extra = { 'data-kind': e.kind, 'data-ref': e.ref, 'data-end': e.end };
	const c = e.cardinality ? chenCardinality(e.cardinality) : undefined;
	const parts = c?.total && !e.loop ? doubleLine(e.from, e.to, theme, extra) : [edgeShape(e, theme, extra)];
	if (c) {
		const p = nearEnd(e, 16, 10);
		parts.push(textEl(p.x, p.y, c.label, { size: 12, weight: 'bold', anchor: 'middle', fill: theme.text, halo: theme.background, extra: { 'data-cardinality-of': e.ref } }));
	}
	return el('g', {}, parts);
}

export function renderChen(model: ErdModel, layout: ErdLayout, theme: ErdTheme): RenderParts {
	const edges = layout.edges.map((e) => edgeMarks(e, theme));

	const symbols = layout.symbols.map((s) => {
		if (s.kind === 'ellipse') return attributeEllipse(s, theme);
		if (s.kind === 'isa') {
			const sup = model.inheritances.find((i) => i.subIri === s.ref && s.id === `isa:${i.subIri}>${i.superIri}`)!;
			const t = layout.entities[sup.superIri];
			const cx = s.rect.x + s.rect.width / 2;
			return el('g', {}, [
				isaTriangle(s, { x: t.x + t.width / 2, y: t.y + t.height / 2 }, theme),
				textEl(cx, s.rect.y + s.rect.height / 2 + 5, 'ISA', { size: 9, anchor: 'middle', fill: theme.text })
			]);
		}
		return el('g', {}, [
			polygonEl(diamondPoints(s.rect), { 'data-kind': 'relationship', 'data-ref': s.ref, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 }),
			textEl(s.rect.x + s.rect.width / 2, s.rect.y + s.rect.height / 2, s.label, { size: 11, anchor: 'middle', fill: theme.text })
		]);
	});

	const boxes = [
		...model.entities.map((e) => entityBox(e, layout.entities[e.iri], theme)),
		...model.externals.map((x) => externalBox(x, layout.entities[x.iri], theme))
	];
	return { defs: [], body: [...edges, ...symbols, ...boxes] };
}
