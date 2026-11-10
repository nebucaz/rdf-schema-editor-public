import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import GovernanceSettingsForm from './GovernanceSettingsForm.svelte';

const initial = { steward: 'Ann', authority: '', maturity: '' as const, version: '' };

describe('GovernanceSettingsForm (STORY-331)', () => {
	it('shows the stored values and saves the edited ones', async () => {
		const onSave = vi.fn(async () => {});
		render(GovernanceSettingsForm, { props: { initial, onSave } });
		expect((screen.getByLabelText('Steward') as HTMLInputElement).value).toBe('Ann');
		await fireEvent.input(screen.getByLabelText('Authority'), { target: { value: 'Data Office' } });
		await fireEvent.change(screen.getByLabelText('Maturity'), { target: { value: 'pilot' } });
		await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '1.0.0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onSave).toHaveBeenCalledWith({ steward: 'Ann', authority: 'Data Office', maturity: 'pilot', version: '1.0.0' }));
	});

	it('refuses an invalid version without saving', async () => {
		const onSave = vi.fn(async () => {});
		render(GovernanceSettingsForm, { props: { initial, onSave } });
		await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '1.0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByRole('alert').textContent).toMatch(/three numbers/i);
		expect(onSave).not.toHaveBeenCalled();
	});

	it('notes that names are recorded, not enforced', () => {
		render(GovernanceSettingsForm, { props: { initial, onSave: vi.fn(async () => {}) } });
		expect(screen.getByText(/recorded, not enforced/i)).toBeTruthy();
	});
});
