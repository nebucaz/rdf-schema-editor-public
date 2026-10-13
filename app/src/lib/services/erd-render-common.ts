import { el, headerColors, type ErdTheme } from '$lib/utils/erd-svg';
import type { ErdEntity, ErdExternal, ErdModel } from './erd-model';
import { attributeText, type ErdLayout, type Notation, type PlacedEdge, type Point, type Rect } from './erd-layout';

/** Helpers shared by the three notation renderers (STORY-155–157) and the legend (STORY-158). */

export interface RenderParts {
	defs: string[];
	body: string[];
}

export interface RendererOptions {
	/** Crow's Foot only: also draw the (unconstrained) `0..*` symbol at each relation's source end. */
	sourceMarker?: boolean;
}

export type NotationRenderer = (model: ErdModel, layout: ErdLayout, theme: ErdTheme, options?: RendererOptions) => RenderParts;

export const FONT_FAMILY = 'Helvetica, Arial, sans-serif';
export const GENERALIZATION_MARKER = 'erd-generalization';

export const num = (v: number): number => Math.round(v * 100) / 100;

interface TextStyle {
	size?: number;
	weight?: 'normal' | 'bold';
	anchor?: 'start' | 'middle' | 'end';
	fill: string;
	italic?: boolean;
	/** Halo colour painted behind the glyphs so labels stay legible over lines. */
	halo?: string;
	/** Halo stroke width (default 3); wider values knock the line out from behind a label. */
	haloWidth?: number;
	extra?: Record<string, string | undefined>;
}

/** Text whose `y` is the vertical centre (a manual baseline shift — `dominant-baseline` is patchy in editors). */
export function textEl(x: number, y: number, s: string, style: TextStyle): string {
	const size = style.size ?? 12;
	return el(
		'text',
		{
			...style.extra,
			x: num(x),
			y: num(y + size * 0.35),
			'font-family': FONT_FAMILY,
			'font-size': size,
			'font-weight': style.weight === 'bold' ? 'bold' : undefined,
			'font-style': style.italic ? 'italic' : undefined,
			'text-anchor': style.anchor ?? 'start',
			fill: style.fill,
			stroke: style.halo,
			'stroke-width': style.halo ? (style.haloWidth ?? 3) : undefined,
			'paint-order': style.halo ? 'stroke' : undefined
		},
		s
	);
}

export function lineEl(a: Point, b: Point, theme: ErdTheme, extra: Record<string, string | number | undefined> = {}): string {
	return el('line', {
		x1: num(a.x),
		y1: num(a.y),
		x2: num(b.x),
		y2: num(b.y),
		stroke: theme.stroke,
		'stroke-width': 1.5,
		...extra
	});
}

/** An edge as a line, or its self-loop path (fill none) — `extra` carries markers/dashes/data attrs. */
export function edgeShape(e: PlacedEdge, theme: ErdTheme, extra: Record<string, string | number | undefined> = {}): string {
	if (e.loop) return el('path', { d: e.loop.path, fill: 'none', stroke: theme.stroke, 'stroke-width': 1.5, ...extra });
	if (e.route && e.route.length > 2) {
		const d = e.route.map((q, i) => `${i === 0 ? 'M' : 'L'}${num(q.x)},${num(q.y)}`).join(' ');
		return el('path', { d, fill: 'none', stroke: theme.stroke, 'stroke-width': 1.5, ...extra });
	}
	return lineEl(e.from, e.to, theme, extra);
}

export function polygonEl(points: Point[], attrs: Record<string, string | number | undefined>): string {
	return el('polygon', { points: points.map((p) => `${num(p.x)},${num(p.y)}`).join(' '), ...attrs });
}

export function diamondPoints(r: Rect): Point[] {
	const cx = r.x + r.width / 2;
	const cy = r.y + r.height / 2;
	return [
		{ x: cx, y: r.y },
		{ x: r.x + r.width, y: cy },
		{ x: cx, y: r.y + r.height },
		{ x: r.x, y: cy }
	];
}

/** Closed hollow triangle, apex at `(0,0)` pointing along +x — shared by Crow's Foot and UML. */
export function generalizationMarker(theme: ErdTheme): string {
	return el(
		'marker',
		{ id: GENERALIZATION_MARKER, markerUnits: 'userSpaceOnUse', orient: 'auto', refX: 0, refY: 0, overflow: 'visible' },
		[el('path', { d: 'M0,0 L-14,-8 L-14,8 Z', fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 })]
	);
}

export function headerFill(theme: ErdTheme, e: ErdEntity) {
	return headerColors(theme, e.color);
}

/** Class-style box: header band + attribute list. Used by Crow's Foot and UML. */
export function classBox(e: ErdEntity, r: Rect, theme: ErdTheme, notation: Notation, rounded = false): string {
	const hdr = headerFill(theme, e);
	const radius = rounded ? 10 : undefined;
	const parts: string[] = [
		el('rect', { 'data-iri': e.iri, x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height), rx: radius, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 }),
		el('rect', { x: num(r.x), y: num(r.y), width: num(r.width), height: 28, rx: radius, fill: hdr.fill, stroke: theme.stroke, 'stroke-width': 1.5 })
	];
	if (rounded) parts.push(el('rect', { x: num(r.x + 1), y: num(r.y + 14), width: num(r.width - 2), height: 13, fill: hdr.fill }));
	parts.push(
		textEl(r.x + r.width / 2, r.y + 14, e.name, { size: 14, weight: 'bold', anchor: 'middle', fill: hdr.text }),
		lineEl({ x: r.x, y: r.y + 28 }, { x: r.x + r.width, y: r.y + 28 }, theme)
	);
	e.attributes.forEach((a, i) => {
		parts.push(
			textEl(r.x + 12, r.y + 28 + 9 + i * 18 + 3, attributeText(a, notation), {
				fill: a.inheritedFrom ? theme.mutedText : theme.text,
				italic: a.inheritedFrom !== undefined
			})
		);
	});
	return el('g', {}, parts);
}

/** External (out-of-workspace) class: minimal dashed box with its prefixed name. */
export function externalBox(x: ErdExternal, r: Rect, theme: ErdTheme): string {
	return el('g', {}, [
		el('rect', { 'data-iri': x.iri, 'data-external': 'true', x: num(r.x), y: num(r.y), width: num(r.width), height: num(r.height), fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5, 'stroke-dasharray': '6 4' }),
		textEl(r.x + r.width / 2, r.y + r.height / 2, x.prefixedName, { anchor: 'middle', fill: theme.text })
	]);
}

/** Point `dist` back from `e.to` along the edge, shifted `side` px perpendicular — for end labels. */
export function nearEnd(e: PlacedEdge, dist: number, side: number): Point {
	if (e.loop) return { x: e.loop.labelX, y: e.loop.labelY };
	// Follow the last segment of an orthogonal route so the label hugs the end it describes.
	const prev = e.route && e.route.length > 1 ? e.route[e.route.length - 2] : e.from;
	const dx = e.to.x - prev.x;
	const dy = e.to.y - prev.y;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	return { x: e.to.x - ux * dist - uy * side, y: e.to.y - uy * dist + ux * side };
}
