import { darkTheme, el, heuristicMeasurer, lightTheme, svgDocument, type TextMeasurer } from '$lib/utils/erd-svg';
import type { ErdModel } from './erd-model';
import { layoutErd, type Notation, type Point } from './erd-layout';
import type { NotationRenderer } from './erd-render-common';
import { renderCrowsFoot } from './erd-render-crows-foot';
import { buildLegend } from './erd-legend';
import { renderChen } from './erd-render-chen';
import { renderUml } from './erd-render-uml';

export interface RenderErdOptions {
	theme?: 'light' | 'dark';
	/** Draw the notation legend (STORY-158). Default true. */
	legend?: boolean;
	measurer?: TextMeasurer;
	/** Crow's Foot: draw `0..*` at relation source ends (the Settings preference). Default false. */
	sourceMarker?: boolean;
}

const LEGEND_MARGIN = 16;

/** Notation registry — one renderer per `Notation`. */
export const NOTATION_RENDERERS: Partial<Record<Notation, NotationRenderer>> = {
	'crows-foot': renderCrowsFoot,
	uml: renderUml,
	chen: renderChen
};

/** Lays out `model` (keeping `positions`) and renders it as a strict, standalone SVG document. */
export function renderErd(
	model: ErdModel,
	positions: Record<string, Point>,
	notation: Notation,
	options: RenderErdOptions = {}
): string {
	const renderer = NOTATION_RENDERERS[notation];
	if (!renderer) throw new Error(`No ERD renderer registered for notation "${notation}"`);
	const theme = options.theme === 'dark' ? darkTheme : lightTheme;
	const measurer = options.measurer ?? heuristicMeasurer;
	const layout = layoutErd(model, positions, notation, measurer);
	const parts = renderer(model, layout, theme, { sourceMarker: options.sourceMarker });
	const body = [...parts.body];
	let viewBox = layout.bounds;
	if (options.legend !== false) {
		const legend = buildLegend(notation, theme, measurer, { sourceMarker: options.sourceMarker });
		const x = layout.bounds.x;
		const y = layout.bounds.y + layout.bounds.height;
		body.push(el('g', { 'data-legend': 'true', transform: `translate(${x} ${y})` }, legend.body));
		viewBox = {
			x,
			y: layout.bounds.y,
			width: Math.max(layout.bounds.width, legend.width + LEGEND_MARGIN),
			height: layout.bounds.height + legend.height + LEGEND_MARGIN
		};
	}
	return svgDocument({ viewBox, defs: parts.defs, body, background: theme.background });
}
