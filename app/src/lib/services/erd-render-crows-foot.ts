import { el, type ErdTheme } from '$lib/utils/erd-svg';
import type { Cardinality, ErdModel } from './erd-model';
import type { ErdLayout } from './erd-layout';
import {
	classBox,
	edgeShape,
	externalBox,
	generalizationMarker,
	GENERALIZATION_MARKER,
	textEl,
	type RendererOptions,
	type RenderParts
} from './erd-render-common';

/** Crow's Foot (Information Engineering) renderer — symbol specs in `spec/export-erd/notation-reference.md` §1. */

/** Source-end cardinality: the editor's flags describe only the target end. */
export const SOURCE_END_CARDINALITY: Cardinality = '0..*';

export const CROWS_FOOT_MARKERS: Record<Cardinality, string> = {
	'0..1': 'erd-cf-zero-one',
	'1': 'erd-cf-one',
	'0..*': 'erd-cf-zero-many',
	'1..*': 'erd-cf-one-many'
};

/**
 * Markers are authored with the line end at x=0, symbols extending back along -x (`orient="auto"`).
 * Bars sit innermost (nearest the entity), rings outermost.
 */
export function crowsFootMarkers(theme: ErdTheme): string[] {
	const stroke = { stroke: theme.stroke, 'stroke-width': 1.5, fill: 'none' };
	const bar = (x: number) => el('line', { x1: x, y1: -6, x2: x, y2: 6, ...stroke });
	const ring = (x: number) => el('circle', { cx: x, cy: 0, r: 5, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 });
	const foot = () => [
		el('line', { x1: -12, y1: 0, x2: 0, y2: -7, ...stroke }),
		el('line', { x1: -12, y1: 0, x2: 0, y2: 0, ...stroke }),
		el('line', { x1: -12, y1: 0, x2: 0, y2: 7, ...stroke })
	];
	const marker = (card: Cardinality, children: string[]) =>
		el('marker', { id: CROWS_FOOT_MARKERS[card], markerUnits: 'userSpaceOnUse', orient: 'auto-start-reverse', refX: 0, refY: 0, overflow: 'visible' }, children);
	return [
		marker('0..1', [ring(-15), bar(-6)]),
		marker('1', [bar(-6), bar(-12)]),
		marker('0..*', [ring(-17), ...foot()]),
		marker('1..*', [bar(-16), ...foot()])
	];
}

export function renderCrowsFoot(model: ErdModel, layout: ErdLayout, theme: ErdTheme, options: RendererOptions = {}): RenderParts {
	const labels: string[] = [];
	const edges = layout.edges.map((e) => {
		if (e.kind === 'inheritance') {
			return edgeShape(e, theme, { 'data-kind': 'inheritance', 'marker-end': `url(#${GENERALIZATION_MARKER})` });
		}
		const line = edgeShape(e, theme, {
			'data-kind': e.kind,
			'data-ref': e.ref,
			'marker-end': e.cardinality ? `url(#${CROWS_FOOT_MARKERS[e.cardinality]})` : undefined,
			// Optional (Settings): the model records no cardinality for the source (domain) end — any
			// number of sources may reference one target — so the standard-but-noisy `0..*` is drawn.
			'marker-start': e.cardinality && options.sourceMarker ? `url(#${CROWS_FOOT_MARKERS[SOURCE_END_CARDINALITY]})` : undefined
		});
		if (e.name) labels.push(textEl(e.label.x, e.label.y, e.name, { size: 11, anchor: 'middle', fill: theme.text, halo: theme.background, haloWidth: 8 }));
		return line;
	});

	const boxes = [
		...model.entities.map((e) => classBox(e, layout.entities[e.iri], theme, 'crows-foot', e.isAssociationClass)),
		...model.externals.map((x) => externalBox(x, layout.entities[x.iri], theme))
	];
	return { defs: [...crowsFootMarkers(theme), generalizationMarker(theme)], body: [...edges, ...labels, ...boxes] };
}
