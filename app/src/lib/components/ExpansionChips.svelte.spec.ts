import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExpansionChips from './ExpansionChips.svelte';
import type { Expansion } from '#lib/services/query-expansion.js';

const expansion: Expansion = {
	query: 'staff',
	chips: [
		{ term: 'Personnel', key: 'personnel', via: 'synonym' },
		{ term: 'Nurse', key: 'nurse', via: 'narrower' }
	],
	hiddenTerms: ['Headcount'],
	truncated: true
};

function setup(over: Record<string, unknown> = {}) {
	const onToggleTerm = vi.fn();
	const onOptions = vi.fn();
	const view = render(ExpansionChips, {
		props: { expansion, switchedOff: new Set<string>(['nurse']), narrower: true, broader: false, onToggleTerm, onOptions, ...over }
	});
	return { onToggleTerm, onOptions, ...view };
}

describe('ExpansionChips', () => {
	it('shows each term as a switchable chip and never the hidden labels', async () => {
		const { onToggleTerm, container } = setup();
		expect(screen.getByText(/Also searching for/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Personnel' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: 'Nurse' }).getAttribute('aria-pressed')).toBe('false');
		expect(container.textContent).not.toContain('Headcount');
		await fireEvent.click(screen.getByRole('button', { name: 'Nurse' }));
		expect(onToggleTerm).toHaveBeenCalledWith('nurse');
	});

	it('has separate switches for narrower and broader terms and says when terms were cut', async () => {
		const { onOptions } = setup();
		await fireEvent.click(screen.getByLabelText('Include narrower terms'));
		expect(onOptions).toHaveBeenCalledWith({ narrower: false, broader: false });
		await fireEvent.click(screen.getByLabelText('Include broader terms'));
		expect(onOptions).toHaveBeenLastCalledWith({ narrower: true, broader: true });
		expect(screen.getByText(/first 20 terms/)).toBeTruthy();
	});

	it('renders nothing when no concept matched', () => {
		const { container } = setup({ expansion: { query: 'x', chips: [], hiddenTerms: [], truncated: false } });
		expect(container.textContent?.trim()).toBe('');
	});
});
