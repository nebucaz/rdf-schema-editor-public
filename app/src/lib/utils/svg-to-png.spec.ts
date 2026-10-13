import { describe, expect, it } from 'vitest';
import { MAX_PNG_SIDE, pngDimensions } from './svg-to-png';

const svg = (vb: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1" height="1"><rect/></svg>`;

describe('pngDimensions', () => {
	it('multiplies the viewBox size by the scale and rounds up', () => {
		expect(pngDimensions(svg('-24 -24 500 300'), 2)).toEqual({ width: 1000, height: 600, scale: 2 });
		expect(pngDimensions(svg('0 0 100.2 50'), 1.5)).toEqual({ width: 151, height: 75, scale: 1.5 });
	});

	it('defaults to 2×', () => {
		expect(pngDimensions(svg('0 0 10 20'))).toMatchObject({ width: 20, height: 40, scale: 2 });
	});

	it('accepts comma separators and exponent-free decimals', () => {
		expect(pngDimensions(svg('0,0,10,20'), 1)).toMatchObject({ width: 10, height: 20 });
	});

	it('caps the longest side, shrinking the scale to match', () => {
		const d = pngDimensions(svg('0 0 10000 100'), 2);
		expect(d.width).toBe(MAX_PNG_SIDE);
		expect(d.scale).toBeCloseTo(MAX_PNG_SIDE / 10000);
		expect(d.height).toBe(Math.ceil(100 * d.scale));
	});

	it('rejects a missing/degenerate viewBox and bad scales', () => {
		expect(() => pngDimensions('<svg xmlns="http://www.w3.org/2000/svg"/>', 2)).toThrow(/viewBox/);
		expect(() => pngDimensions(svg('0 0 0 10'), 2)).toThrow(/viewBox/);
		expect(() => pngDimensions(svg('0 0 10 10'), 0)).toThrow(/scale/);
	});
});
