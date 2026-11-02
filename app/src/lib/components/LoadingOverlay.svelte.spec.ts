import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import LoadingOverlay from './LoadingOverlay.svelte';

describe('LoadingOverlay', () => {
	it('renders nothing while inactive', () => {
		render(LoadingOverlay, { props: { active: false } });
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('renders an accessible busy status while active', () => {
		render(LoadingOverlay, { props: { active: true } });
		const status = screen.getByRole('status');
		expect(status.getAttribute('aria-busy')).toBe('true');
		expect(status.getAttribute('aria-label')).toBe('Loading workspace');
	});

	it('accepts a custom label', () => {
		render(LoadingOverlay, { props: { active: true, label: 'Switching workspace' } });
		expect(screen.getByRole('status').getAttribute('aria-label')).toBe('Switching workspace');
	});
});
