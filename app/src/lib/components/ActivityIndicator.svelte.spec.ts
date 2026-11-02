import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import ActivityIndicator from './ActivityIndicator.svelte';

describe('ActivityIndicator', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('is hidden when not busy', () => {
		render(ActivityIndicator, { props: { busy: false } });
		vi.advanceTimersByTime(1000);
		flushSync();
		expect(screen.queryByTestId('activity-indicator')).toBeNull();
	});

	it('shows only after busy has lasted past the debounce delay', () => {
		render(ActivityIndicator, { props: { busy: true } });
		expect(screen.queryByTestId('activity-indicator')).toBeNull();
		vi.advanceTimersByTime(199);
		flushSync();
		expect(screen.queryByTestId('activity-indicator')).toBeNull();
		vi.advanceTimersByTime(2);
		flushSync();
		expect(screen.getByTestId('activity-indicator')).toBeTruthy();
	});

	it('never shows when busy ends within the delay', async () => {
		const view = render(ActivityIndicator, { props: { busy: true } });
		vi.advanceTimersByTime(100);
		await view.rerender({ busy: false });
		vi.advanceTimersByTime(1000);
		flushSync();
		expect(screen.queryByTestId('activity-indicator')).toBeNull();
	});

	it('stays hidden while suppressed (the overlay is showing)', () => {
		render(ActivityIndicator, { props: { busy: true, suppressed: true } });
		vi.advanceTimersByTime(1000);
		flushSync();
		expect(screen.queryByTestId('activity-indicator')).toBeNull();
	});

	it('is a non-blocking status', () => {
		render(ActivityIndicator, { props: { busy: true } });
		vi.advanceTimersByTime(300);
		flushSync();
		const el = screen.getByTestId('activity-indicator');
		expect(el.getAttribute('role')).toBe('status');
		expect(el.getAttribute('aria-label')).toBe('Working');
	});
});
