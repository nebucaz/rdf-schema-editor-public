import type { TextMeasurer } from './erd-svg';

/**
 * Browser `TextMeasurer` backed by `canvas.measureText` (STORY-153) — selected at the call site
 * (the export dialog), never imported by the pure renderer modules. Falls back to `fallback` if a 2D
 * context is unavailable.
 */
export function createCanvasMeasurer(fontFamily: string, fallback: TextMeasurer): TextMeasurer {
	const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
	if (!ctx) return fallback;
	return (text, fontSize, fontWeight = 'normal') => {
		ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
		return ctx.measureText(text).width;
	};
}
