import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import ManageMembersModal from './ManageMembersModal.svelte';

// spec/unify-instance-forms STORY-005: the modal is only the list; add/edit open the shared dialogs in the host.
const members = [
	{ iri: 'urn:app#1', label: 'DelayMeter Backend' },
	{ iri: 'urn:app#2', label: 'Billing' }
] as never;

function mount(overrides: Record<string, unknown> = {}) {
	const props = { members, onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(async () => {}), ...overrides };
	render(ManageMembersModal, { props });
	return props;
}

describe('ManageMembersModal list', () => {
	it('lists the members and says so when there are none', () => {
		mount();
		expect(screen.getByText('DelayMeter Backend')).toBeTruthy();
		expect(screen.getByText('Billing')).toBeTruthy();
	});

	it('the pencil hands the member to onEdit', async () => {
		const props = mount();
		await fireEvent.click(screen.getByLabelText('Edit Billing'));
		expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ iri: 'urn:app#2' }));
	});

	it('+ Add member calls onAdd', async () => {
		const props = mount();
		await fireEvent.click(screen.getByText('+ Add member'));
		expect(props.onAdd).toHaveBeenCalled();
	});

	it('delete asks for confirmation, then calls onDelete', async () => {
		const props = mount();
		await fireEvent.click(screen.getByLabelText('Delete Billing'));
		expect(props.onDelete).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ iri: 'urn:app#2' })));
	});

	it('a failing delete shows the error and keeps the confirmation open', async () => {
		mount({ onDelete: vi.fn(async () => Promise.reject(new Error('blocked'))) });
		await fireEvent.click(screen.getByLabelText('Delete Billing'));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		expect(await screen.findByText('blocked')).toBeTruthy();
	});
});
