import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ConceptHistory from './ConceptHistory.svelte';

describe('ConceptHistory (STORY-407)', () => {
	it('lists who changed the concept, when and in which version, read-only', () => {
		const { container } = render(ConceptHistory, {
			props: {
				history: [{ summary: 'Edited concept "Bank"', changedBy: 'bo', changedAt: '2026-11-05T09:00:00Z', version: '1.1.0' }]
			}
		});
		expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
		expect(screen.getByText('Edited concept "Bank"')).toBeTruthy();
		expect(container.textContent).toContain('bo');
		expect(container.textContent).toContain('2026-11-05');
		expect(container.textContent).toContain('1.1.0');
		expect(container.querySelector('button, input, textarea')).toBeNull();
	});

	it('says so when nothing was logged', () => {
		render(ConceptHistory, { props: { history: [] } });
		expect(screen.getByText(/No changes logged/i)).toBeTruthy();
	});
});
