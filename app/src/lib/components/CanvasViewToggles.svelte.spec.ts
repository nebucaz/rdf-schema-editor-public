import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CanvasViewToggles from './CanvasViewToggles.svelte';
import { workbenchActions } from '#lib/stores/workbench-actions.svelte.js';

const DESCRIPTION = 'Toggle description visibility';
const INHERITED = 'Toggle inherited attributes visibility';
const REVERSE = 'Toggle reverse relations visibility';
const CONCEPT = 'Toggle badge for classes without a concept';

describe('CanvasViewToggles', () => {
	beforeEach(() => {
		// The reverse relations toggle delegates to the canvas page, which owns the state; stand in for it.
		workbenchActions.registerToggleReverseRelationsVisibility(() => {
			workbenchActions.showReverseRelations = !workbenchActions.showReverseRelations;
		});
	});

	it('always renders the description, inherited attributes and reverse relations toggles', () => {
		render(CanvasViewToggles, { props: { showConceptBadge: false } });
		expect(screen.getByLabelText(DESCRIPTION)).toBeTruthy();
		expect(screen.getByLabelText(INHERITED)).toBeTruthy();
		expect(screen.getByLabelText(REVERSE)).toBeTruthy();
	});

	it('renders the concept badge toggle only when showConceptBadge is true', () => {
		const { unmount } = render(CanvasViewToggles, { props: { showConceptBadge: false } });
		expect(screen.queryByLabelText(CONCEPT)).toBeNull();
		unmount();
		render(CanvasViewToggles, { props: { showConceptBadge: true } });
		expect(screen.getByLabelText(CONCEPT)).toBeTruthy();
	});

	it.each([DESCRIPTION, INHERITED, REVERSE, CONCEPT])(
		'clicking "%s" flips aria-pressed',
		async (label) => {
			render(CanvasViewToggles, { props: { showConceptBadge: true } });
			const button = screen.getByLabelText(label);
			const before = button.getAttribute('aria-pressed');
			await fireEvent.click(button);
			expect(button.getAttribute('aria-pressed')).not.toBe(before);
		}
	);
});
