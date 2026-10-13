import { el, type ErdTheme, type TextMeasurer } from '$lib/utils/erd-svg';
import type { Cardinality } from './erd-model';
import type { Notation, Point, Rect } from './erd-layout';
import { diamondPoints, GENERALIZATION_MARKER, lineEl, polygonEl, textEl } from './erd-render-common';
import { CROWS_FOOT_MARKERS } from './erd-render-crows-foot';
import { doubleLine } from './erd-render-chen';

/**
 * Per-notation legend (STORY-158). Samples are drawn with the diagram's own marker ids and shape
 * helpers, so the legend and the diagram share one geometry. Conventions mirror
 * `spec/export-erd/notation-reference.md`.
 */

export interface LegendEntry {
	id: string;
	text: string;
	/** Sample drawing in a 90×28 cell whose origin is `o` (vertical centre at `o.y + 14`). */
	sample: (o: Point, theme: ErdTheme) => string;
}

const ROW_H = 28;
const SAMPLE_W = 90;
const PAD = 12;
const TITLE_H = 30;
const FONT = 11;

const CARD_TEXT: Record<Cardinality, string> = {
	'0..1': 'zero or one',
	'1': 'exactly one',
	'0..*': 'zero or many',
	'1..*': 'one or many'
};
const CF_SYMBOLS: Record<Cardinality, string> = {
	'0..1': 'ring + bar',
	'1': 'two bars',
	'0..*': 'ring + crow foot',
	'1..*': 'bar + crow foot'
};
const CARDINALITIES: Cardinality[] = ['0..1', '1', '0..*', '1..*'];

const ends = (o: Point): [Point, Point] => [
	{ x: o.x + 4, y: o.y + 14 },
	{ x: o.x + SAMPLE_W - 6, y: o.y + 14 }
];
const stroke = (theme: ErdTheme) => ({ fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 });
const box = (o: Point, theme: ErdTheme, extra: Record<string, string | number | undefined> = {}) =>
	el('rect', { x: o.x + 20, y: o.y + 5, width: 44, height: 18, ...stroke(theme), ...extra });

const inheritedSample = (o: Point, theme: ErdTheme) =>
	textEl(o.x + 4, o.y + 14, 'name (from X)', { size: 10, italic: true, fill: theme.mutedText });
const externalSample = (o: Point, theme: ErdTheme) => box(o, theme, { 'stroke-dasharray': '6 4' });
const noteEntry = (id: string, text = 'Cardinality is shown at the target (range) end only'): LegendEntry => ({
	id,
	text,
	sample: () => ''
});

function crowsFoot(sourceMarker = false): LegendEntry[] {
	return [
		...CARDINALITIES.map(
			(c): LegendEntry => ({
				id: `cf-${c}`,
				text: `${c} - ${CARD_TEXT[c]} (${CF_SYMBOLS[c]})`,
				sample: (o, t) => {
					const [a, b] = ends(o);
					return lineEl(a, b, t, { 'marker-end': `url(#${CROWS_FOOT_MARKERS[c]})` });
				}
			})
		),
		{
			id: 'cf-gen',
			text: 'Generalisation (subclass of): hollow triangle at the supertype',
			sample: (o, t) => {
				const [a, b] = ends(o);
				return lineEl(a, b, t, { 'marker-end': `url(#${GENERALIZATION_MARKER})` });
			}
		},
		{ id: 'cf-assoc', text: 'Association class: entity box with rounded corners', sample: (o, t) => box(o, t, { rx: 8 }) },
		{ id: 'cf-attr', text: 'Attribute: * required, o optional, type[] repeatable', sample: (o, t) => textEl(o.x + 4, o.y + 14, '* name : type', { size: 10, fill: t.text }) },
		{ id: 'cf-inh', text: 'Inherited attribute: italic, with (from Origin)', sample: inheritedSample },
		{ id: 'cf-ext', text: 'External class: dashed box', sample: externalSample },
		noteEntry(
			'cf-note',
			sourceMarker
				? 'Target (range) end shows the cardinality; the source end is 0..* (unconstrained)'
				: 'Cardinality is shown at the target (range) end only'
		)
	];
}

function uml(): LegendEntry[] {
	return [
		...CARDINALITIES.map(
			(c): LegendEntry => ({
				id: `uml-${c}`,
				text: `${c} - multiplicity: ${CARD_TEXT[c]}`,
				sample: (o, t) => {
					const [a, b] = ends(o);
					return el('g', {}, [lineEl(a, b, t), textEl(b.x - 14, b.y - 9, c, { size: 10, anchor: 'middle', fill: t.text })]);
				}
			})
		),
		{
			id: 'uml-gen',
			text: 'Generalisation (subclass of): hollow triangle at the superclass',
			sample: (o, t) => {
				const [a, b] = ends(o);
				return lineEl(a, b, t, { 'marker-end': `url(#${GENERALIZATION_MARKER})` });
			}
		},
		{
			id: 'uml-assoc',
			text: 'Association class: class box joined by a dashed line to the association diamond',
			sample: (o, t) =>
				el('g', {}, [
					polygonEl(diamondPoints({ x: o.x + 4, y: o.y + 6, width: 18, height: 16 }), stroke(t)),
					lineEl({ x: o.x + 22, y: o.y + 14 }, { x: o.x + 44, y: o.y + 14 }, t, { 'stroke-dasharray': '4 3' }),
					el('rect', { x: o.x + 44, y: o.y + 5, width: 40, height: 18, ...stroke(t) })
				])
		},
		{ id: 'uml-inh', text: 'Inherited attribute: italic, with (from Origin)', sample: inheritedSample },
		{ id: 'uml-ext', text: 'External class: dashed box', sample: externalSample },
		noteEntry('uml-note')
	];
}

function chen(): LegendEntry[] {
	const cardLine = (total: boolean, label: string) => (o: Point, t: ErdTheme) => {
		const [a, b] = ends(o);
		const line = total ? doubleLine(a, b, t, {}) : [lineEl(a, b, t)];
		return el('g', {}, [...line, textEl(b.x - 10, b.y - 9, label, { size: 11, weight: 'bold', anchor: 'middle', fill: t.text })]);
	};
	const ellipse = (o: Point, t: ErdTheme, extra: Record<string, string | number | undefined> = {}, inner = false) =>
		el('g', {}, [
			el('ellipse', { cx: o.x + 44, cy: o.y + 14, rx: 26, ry: 10, ...stroke(t), ...extra }),
			...(inner ? [el('ellipse', { cx: o.x + 44, cy: o.y + 14, rx: 23, ry: 7, ...stroke(t) })] : [])
		]);
	const diamond = (r: Rect, t: ErdTheme) => polygonEl(diamondPoints(r), stroke(t));
	return [
		{ id: 'chen-1', text: '1 - at most one, single line (partial participation)', sample: cardLine(false, '1') },
		{ id: 'chen-1t', text: '1 - exactly one, double line (total participation)', sample: cardLine(true, '1') },
		{ id: 'chen-n', text: 'N - many, single line (partial participation)', sample: cardLine(false, 'N') },
		{ id: 'chen-nt', text: 'N - one or many, double line (total participation)', sample: cardLine(true, 'N') },
		{ id: 'chen-rel', text: 'Relationship: diamond between its two entities', sample: (o, t) => diamond({ x: o.x + 22, y: o.y + 3, width: 44, height: 22 }, t) },
		{ id: 'chen-attr', text: 'Attribute: ellipse; solid = required, dashed = optional', sample: (o, t) => ellipse(o, t) },
		{ id: 'chen-multi', text: 'Multivalued (repeatable) attribute: double ellipse', sample: (o, t) => ellipse(o, t, {}, true) },
		{ id: 'chen-inh', text: 'Inherited attribute: dotted ellipse, with (from Origin)', sample: (o, t) => ellipse(o, t, { 'stroke-dasharray': '2 3' }) },
		{
			id: 'chen-isa',
			text: 'ISA: subclass of, triangle pointing at the supertype',
			sample: (o, t) => polygonEl([{ x: o.x + 44, y: o.y + 3 }, { x: o.x + 58, y: o.y + 25 }, { x: o.x + 30, y: o.y + 25 }], stroke(t))
		},
		{
			id: 'chen-assoc',
			text: 'Association class: entity rectangle containing a relationship diamond',
			sample: (o, t) => el('g', {}, [box(o, t), polygonEl(diamondPoints({ x: o.x + 20, y: o.y + 5, width: 44, height: 18 }), { ...stroke(t), fill: 'none' })])
		},
		{ id: 'chen-ext', text: 'External class: dashed rectangle', sample: externalSample },
		noteEntry('chen-note')
	];
}

export function legendEntries(notation: Notation, options: { sourceMarker?: boolean } = {}): LegendEntry[] {
	return notation === 'crows-foot' ? crowsFoot(options.sourceMarker) : notation === 'uml' ? uml() : chen();
}

export interface Legend {
	/** Elements in a local frame whose origin is the legend's top-left. */
	body: string[];
	width: number;
	height: number;
}

export function buildLegend(
	notation: Notation,
	theme: ErdTheme,
	measure: TextMeasurer,
	options: { sourceMarker?: boolean } = {}
): Legend {
	const entries = legendEntries(notation, options);
	const textW = Math.max(...entries.map((e) => measure(e.text, FONT)));
	const width = Math.ceil(PAD + SAMPLE_W + 12 + textW + PAD);
	const height = TITLE_H + entries.length * ROW_H + PAD;
	const body: string[] = [
		el('rect', { 'data-legend-frame': 'true', x: 0, y: 0, width, height, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1 }),
		textEl(PAD, TITLE_H / 2 + 2, 'Legend', { size: 13, weight: 'bold', fill: theme.text })
	];
	entries.forEach((e, i) => {
		const o = { x: PAD, y: TITLE_H + i * ROW_H };
		body.push(e.sample(o, theme), textEl(PAD + SAMPLE_W + 12, o.y + ROW_H / 2, e.text, { size: FONT, fill: theme.text }));
	});
	return { body, width, height };
}
