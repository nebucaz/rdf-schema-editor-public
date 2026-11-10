import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ReleaseDialog from './ReleaseDialog.svelte';
import type { ChangeKind, ChangeLogItem } from '#lib/services/change-log.js';

const entry = (changeKind: ChangeKind, summary: string): ChangeLogItem => ({
	iri: `urn:e:${summary}`, kind: 'change', summary, rationale: '', term: '', question: '', changeKind,
	version: '', changedBy: 'alice', changedAt: '2026-01-01T00:00:00Z'
});

function setup(entries: ChangeLogItem[], currentVersion = '1.2.3') {
	const onConfirm = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(ReleaseDialog, { props: { entries, currentVersion, onConfirm, onCancel } });
	return { onConfirm, onCancel };
}

describe('ReleaseDialog (STORY-333)', () => {
	it('says there is nothing to release without entries', () => {
		setup([]);
		expect(screen.getByText(/nothing to release/i)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Release' })).toBeNull();
	});

	it('suggests the bump from the log and shows the next version', () => {
		setup([entry('label', 'Edited concept "A"'), entry('addition', 'Added class "B"')]);
		expect((screen.getByLabelText('Version bump') as HTMLSelectElement).value).toBe('minor');
		expect((screen.getByLabelText('New version') as HTMLInputElement).value).toBe('1.3.0');
		expect(screen.getByText(/Suggested: minor/)).toBeTruthy();
	});

	it('generates editable notes from the log', () => {
		setup([entry('addition', 'Added class "B"')]);
		const notes = screen.getByLabelText('Release notes') as HTMLTextAreaElement;
		expect(notes.value).toContain('Release 1.3.0');
		expect(notes.value).toContain('- Added class "B"');
	});

	it('lets the user override the bump, which updates the version', async () => {
		setup([entry('label', 'Edited concept "A"')]);
		await fireEvent.change(screen.getByLabelText('Version bump'), { target: { value: 'major' } });
		expect((screen.getByLabelText('New version') as HTMLInputElement).value).toBe('2.0.0');
	});

	it('confirms with the version and the edited notes', async () => {
		const { onConfirm } = setup([entry('addition', 'Added class "B"')]);
		await fireEvent.input(screen.getByLabelText('Release notes'), { target: { value: 'My notes' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Release' }));
		await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ version: '1.3.0', notes: 'My notes' }));
	});

	it('refuses a version that is not three numbers', async () => {
		const { onConfirm } = setup([entry('addition', 'x')]);
		await fireEvent.input(screen.getByLabelText('New version'), { target: { value: '1.3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Release' }));
		expect(screen.getByRole('alert').textContent).toMatch(/three numbers/i);
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
