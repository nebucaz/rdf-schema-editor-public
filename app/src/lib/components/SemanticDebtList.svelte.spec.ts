import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import SemanticDebtList from './SemanticDebtList.svelte';
import type { DebtItem } from '#lib/services/semantic-debt.js';

const items: DebtItem[] = [
	{ kind: 'undefined-term', elementIri: 'urn:c:a', label: 'Alpha', detail: 'Concept "Alpha" has no definition.', href: '/vocabulary?concept=urn%3Ac%3Aa' },
	{ kind: 'failing-question', elementIri: 'urn:q:1', label: 'Which apps hold PII?', detail: 'It fails in its latest run.', href: '/questions' },
	{ kind: 'class-without-question', elementIri: 'http://e#B', label: 'Beta', detail: 'Not needed by any question.', href: null }
];
const settings = { reviewPeriodMonths: 3, staleAfterMonths: 12 };

describe('SemanticDebtList (STORY-334)', () => {
	it('lists every debt with its kind, and links the element when there is a link', () => {
		render(SemanticDebtList, { props: { items, settings, onSettingsChange: vi.fn() } });
		const rows = screen.getAllByRole('listitem');
		expect(rows).toHaveLength(3);
		expect(within(rows[0]).getByRole('link', { name: 'Alpha' }).getAttribute('href')).toBe('/vocabulary?concept=urn%3Ac%3Aa');
		expect(within(rows[2]).queryByRole('link')).toBeNull();
		expect(screen.getByText('3 items')).toBeTruthy();
	});

	it('filters by kind and by search', async () => {
		render(SemanticDebtList, { props: { items, settings, onSettingsChange: vi.fn() } });
		await fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'failing-question' } });
		expect(screen.getAllByRole('listitem')).toHaveLength(1);
		await fireEvent.change(screen.getByLabelText('Kind'), { target: { value: '' } });
		await fireEvent.input(screen.getByLabelText('Search'), { target: { value: 'alpha' } });
		expect(screen.getAllByRole('listitem')).toHaveLength(1);
	});

	it('says so when there is no debt', () => {
		render(SemanticDebtList, { props: { items: [], settings, onSettingsChange: vi.fn() } });
		expect(screen.getByText(/no known semantic debt/i)).toBeTruthy();
	});

	it('shows the settings and reports a change', async () => {
		const onSettingsChange = vi.fn();
		render(SemanticDebtList, { props: { items, settings, onSettingsChange } });
		expect((screen.getByLabelText('Review questions every (months)') as HTMLInputElement).value).toBe('3');
		await fireEvent.input(screen.getByLabelText('Concept stale after (months)'), { target: { value: '6' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(onSettingsChange).toHaveBeenCalledWith({ reviewPeriodMonths: 3, staleAfterMonths: 6 });
	});

	it('refuses settings that are not whole months', async () => {
		const onSettingsChange = vi.fn();
		render(SemanticDebtList, { props: { items, settings, onSettingsChange } });
		await fireEvent.input(screen.getByLabelText('Review questions every (months)'), { target: { value: '0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(onSettingsChange).not.toHaveBeenCalled();
	});
});
