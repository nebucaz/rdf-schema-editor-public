import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CanvasGrid from './CanvasGrid.svelte';

const base = { width: 1000, height: 700, origin: { x: 400, y: 300 } };

describe('CanvasGrid', () => {
	it('renders column letters and row numbers at a readable zoom', () => {
		render(CanvasGrid, { props: { ...base, viewport: { x: 0, y: 0, zoom: 1 } } });
		expect(screen.getByText('A')).toBeTruthy();
		expect(screen.getByText('B')).toBeTruthy();
		expect(screen.getByText('1')).toBeTruthy();
		expect(screen.getByText('2')).toBeTruthy();
	});

	it('hides labels below zoom 0.4 but keeps the grid lines', () => {
		const { container } = render(CanvasGrid, { props: { ...base, viewport: { x: 0, y: 0, zoom: 0.3 } } });
		expect(screen.queryByText('A')).toBeNull();
		expect(screen.queryByText('1')).toBeNull();
		expect(container.querySelectorAll('line').length).toBeGreaterThan(0);
	});

	it('does not capture pointer events, so nodes stay interactive', () => {
		const { container } = render(CanvasGrid, { props: { ...base, viewport: { x: 0, y: 0, zoom: 1 } } });
		const svg = container.querySelector('svg') as SVGElement;
		expect(svg.getAttribute('class')).toContain('canvas-grid');
		expect(svg.getAttribute('aria-hidden')).toBe('true');
	});
});
