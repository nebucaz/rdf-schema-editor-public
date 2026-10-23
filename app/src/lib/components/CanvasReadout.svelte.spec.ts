import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import CanvasReadout from './CanvasReadout.svelte';

describe('CanvasReadout', () => {
	it('shows the given text without capturing pointer events', () => {
		render(CanvasReadout, { props: { text: 'C4 · x 1240 y 380 · 125%' } });
		const el = screen.getByTestId('canvas-readout');
		expect(el.textContent).toBe('C4 · x 1240 y 380 · 125%');
		expect(el.getAttribute('aria-hidden')).toBe('true');
	});
});
