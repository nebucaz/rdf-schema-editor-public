/**
 * WCAG 2.x relative-luminance contrast utility (STORY-148). No hand-picked brightness threshold —
 * picks whichever of pure black/white wins a direct WCAG contrast-ratio comparison against the
 * input, so it self-corrects for any background color rather than relying on a midpoint guess.
 */

function normalizeHex(hex: string): string {
	const stripped = hex.replace('#', '');
	if (stripped.length === 3) {
		return stripped
			.split('')
			.map((c) => c + c)
			.join('');
	}
	return stripped;
}

/** IEC 61966-2-1 sRGB gamma correction; 0.04045 is the corrected WCAG errata threshold. */
function srgbChannelToLinear(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
	const normalized = normalizeHex(hex);
	const r = parseInt(normalized.substring(0, 2), 16);
	const g = parseInt(normalized.substring(2, 4), 16);
	const b = parseInt(normalized.substring(4, 6), 16);
	return (
		0.2126 * srgbChannelToLinear(r) + 0.7152 * srgbChannelToLinear(g) + 0.0722 * srgbChannelToLinear(b)
	);
}

function contrastRatio(l1: number, l2: number): number {
	const lighter = Math.max(l1, l2);
	const darker = Math.min(l1, l2);
	return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG contrast ratio (1–21) between two `#rrggbb`/`#rgb` colours, order-independent. */
export function wcagContrast(hexA: string, hexB: string): number {
	return contrastRatio(relativeLuminance(hexA), relativeLuminance(hexB));
}

/**
 * Returns whichever of pure black/white yields the higher WCAG contrast ratio against `bgHex`.
 * Accepts both `#rrggbb` and `#rgb` hex input.
 */
export function contrastTextColor(bgHex: string): '#000000' | '#ffffff' {
	const bgLuminance = relativeLuminance(bgHex);
	const contrastWithBlack = contrastRatio(bgLuminance, 0);
	const contrastWithWhite = contrastRatio(bgLuminance, 1);
	return contrastWithBlack > contrastWithWhite ? '#000000' : '#ffffff';
}
