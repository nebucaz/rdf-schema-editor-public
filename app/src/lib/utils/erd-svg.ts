import { contrastTextColor } from './contrast';

/**
 * Strict-SVG primitives for the Export ERD renderers (STORY-153): XML-safe element builders, a
 * deterministic text measurer, and the light/dark theme palettes. Pure and DOM-free — the one
 * browser-backed measurer lives in `erd-measurer-browser.ts` so this module stays importable under
 * Vitest's `node` environment.
 */

/** Escapes the five XML special characters (`&` first so entities aren't double-escaped). */
export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

export type SvgAttrs = Record<string, string | number | undefined>;

/**
 * Serialises one element. A string child is text (escaped); an array holds already-built child
 * elements joined verbatim. Elements with no children self-close. `foreignObject` is rejected
 * outright — the whole point of this renderer is output that opens in Inkscape/Illustrator/Figma.
 */
export function el(name: string, attrs: SvgAttrs = {}, children?: string | string[]): string {
	if (name.toLowerCase() === 'foreignobject') {
		throw new Error('foreignObject is not allowed in strict-SVG ERD output');
	}
	const attrText = Object.entries(attrs)
		.filter(([, v]) => v !== undefined)
		.map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`)
		.join('');
	if (children === undefined || (Array.isArray(children) && children.length === 0)) {
		return `<${name}${attrText}/>`;
	}
	const inner = Array.isArray(children) ? children.join('') : escapeXml(children);
	return `<${name}${attrText}>${inner}</${name}>`;
}

export interface ViewBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Standalone `<svg>` document: namespace, viewBox + explicit size, optional `<defs>`, background. */
export function svgDocument(opts: {
	viewBox: ViewBox;
	body: string | string[];
	defs?: string[];
	background?: string;
}): string {
	const { viewBox: vb, body, defs, background } = opts;
	const parts: string[] = [];
	if (defs && defs.length > 0) parts.push(el('defs', {}, defs));
	if (background) {
		parts.push(el('rect', { x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: background }));
	}
	parts.push(...(Array.isArray(body) ? body : [body]));
	return el(
		'svg',
		{
			xmlns: 'http://www.w3.org/2000/svg',
			viewBox: `${vb.x} ${vb.y} ${vb.width} ${vb.height}`,
			width: vb.width,
			height: vb.height
		},
		parts
	);
}

/** Width in px of `text` at `fontSize` px. Injected into renderers so tests stay deterministic. */
export type TextMeasurer = (text: string, fontSize: number, fontWeight?: 'normal' | 'bold') => number;

const NARROW = new Set("il.,;:'|!jtfI() ".split(''));
const WIDE = new Set('mwMW@'.split(''));

/**
 * Character-class width heuristic (em-fractions of a typical sans-serif): narrow glyphs 0.3, wide 0.85,
 * other capitals/digits 0.64, everything else 0.56; bold adds 8%. `padding` (default 1.05) is the
 * knob against clipping in unusually wide fonts.
 */
export function createHeuristicMeasurer(padding = 1.05): TextMeasurer {
	return (text, fontSize, fontWeight = 'normal') => {
		let em = 0;
		for (const ch of text) {
			if (NARROW.has(ch)) em += 0.3;
			else if (WIDE.has(ch)) em += 0.85;
			else if (/[A-Z0-9]/.test(ch)) em += 0.64;
			else em += 0.56;
		}
		return em * fontSize * (fontWeight === 'bold' ? 1.08 : 1) * padding;
	};
}

export const heuristicMeasurer: TextMeasurer = createHeuristicMeasurer();

export interface ErdTheme {
	name: 'light' | 'dark';
	background: string;
	/** Entity/symbol fill, behind attribute text. */
	surface: string;
	stroke: string;
	text: string;
	mutedText: string;
	/** Header fill when an entity has no namespace colour. */
	headerFallback: string;
}

export const lightTheme: ErdTheme = {
	name: 'light',
	background: '#ffffff',
	surface: '#ffffff',
	stroke: '#334155',
	text: '#0f172a',
	mutedText: '#64748b',
	headerFallback: '#e2e8f0'
};

export const darkTheme: ErdTheme = {
	name: 'dark',
	background: '#0f172a',
	surface: '#1e293b',
	stroke: '#94a3b8',
	text: '#f1f5f9',
	mutedText: '#94a3b8',
	headerFallback: '#334155'
};

/** Header fill + WCAG-contrast text colour; valid in both themes (contrast is computed, not assumed). */
export function headerColors(theme: ErdTheme, namespaceColor?: string): { fill: string; text: string } {
	const fill = namespaceColor ?? theme.headerFallback;
	return { fill, text: contrastTextColor(fill) };
}
