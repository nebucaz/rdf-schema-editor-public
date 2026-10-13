import { describe, expect, it } from 'vitest';
import { contrastTextColor } from './contrast';

describe('contrastTextColor', () => {
	it('returns white text for a pure black background', () => {
		expect(contrastTextColor('#000000')).toBe('#ffffff');
	});

	it('returns black text for a pure white background', () => {
		expect(contrastTextColor('#ffffff')).toBe('#000000');
	});

	it('accepts 3-digit hex shorthand, matching its 6-digit expansion', () => {
		expect(contrastTextColor('#000')).toBe(contrastTextColor('#000000'));
		expect(contrastTextColor('#fff')).toBe(contrastTextColor('#ffffff'));
	});

	it.each(['#ffffff', '#eec39a', '#cbdbfc'])(
		'returns black text for the light PRESET_COLORS entry %s',
		(hex) => {
			expect(contrastTextColor(hex)).toBe('#000000');
		}
	);

	it.each(['#000000', '#222034', '#45283c', '#306082'])(
		'returns white text for the dark PRESET_COLORS entry %s',
		(hex) => {
			expect(contrastTextColor(hex)).toBe('#ffffff');
		}
	);

	it('picks the correct side of the WCAG black/white contrast crossover', () => {
		// #757575 and #767676 straddle the gray value where contrast-vs-black and contrast-vs-white
		// are nearly equal (WCAG ratios ~4.56/4.61 vs ~4.62/4.54) — confirms the ">" comparison picks
		// the actually-higher ratio rather than always landing on one side.
		expect(contrastTextColor('#757575')).toBe('#ffffff');
		expect(contrastTextColor('#767676')).toBe('#000000');
	});
});
