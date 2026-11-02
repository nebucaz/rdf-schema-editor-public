import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import AddNamespaceClassesModal from './AddNamespaceClassesModal.svelte';
import type { FetchedNamespace, FetchedSchema } from '$lib/services/sparql-connector';

const A = 'https://example.com/a';
const B = 'https://example.com/b';
const EMPTY = 'https://example.com/empty';
const cls = (iri: string, label: string, ns: string) => ({ iri, label, comment: null, namespaceBaseIri: ns });
const schema = {
	classes: [
		cls('urn:a:Person', 'Person', A),
		cls('urn:a:Org', 'Org', A),
		cls('urn:a:Team', 'Team', A),
		cls('urn:b:Other', 'Other', B)
	]
} as unknown as FetchedSchema;
const namespaces = [
	{ baseIri: A, prefix: 'a' },
	{ baseIri: B, prefix: 'b' },
	{ baseIri: EMPTY, prefix: 'e' }
] as unknown as FetchedNamespace[];

function setup(over: Record<string, unknown> = {}) {
	const onConfirm = vi.fn();
	const onClose = vi.fn();
	render(AddNamespaceClassesModal, {
		props: { isOpen: true, schema, namespaces, workspaceMembers: new Set<string>(), onConfirm, onClose, ...over }
	});
	return { onConfirm, onClose };
}
const picker = () => screen.getByLabelText('Namespace') as HTMLSelectElement;
const pick = (v: string) => fireEvent.change(picker(), { target: { value: v } });
const rows = () => screen.queryAllByRole('checkbox', { name: /^(?!Select all)/ }) as HTMLInputElement[];
const confirm = () => screen.getByTestId('add-namespace-classes-confirm');

describe('AddNamespaceClassesModal', () => {
	it('lists every namespace in the picker', () => {
		setup();
		const options = within(picker()).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
		expect(options).toEqual(['', A, B, EMPTY]);
	});

	it('lists the namespace classes, all ticked, and shows the count on the confirm button', async () => {
		setup();
		await pick(A);
		expect(rows().map((r) => r.getAttribute('aria-label') ?? r.closest('label')?.textContent?.trim())).toEqual(
			expect.arrayContaining(['Org', 'Person', 'Team'])
		);
		expect(rows()).toHaveLength(3);
		expect(rows().every((r) => r.checked)).toBe(true);
		expect(confirm().textContent).toContain('Add 3 classes');
	});

	it('removes an unticked class from the confirm payload', async () => {
		const { onConfirm } = setup();
		await pick(A);
		await fireEvent.click(screen.getByRole('checkbox', { name: /Person/ }));
		expect(confirm().textContent).toContain('Add 2 classes');
		await fireEvent.click(confirm());
		expect(onConfirm).toHaveBeenCalledWith(['urn:a:Org', 'urn:a:Team']);
	});

	it('shows existing members disabled, unticked and labelled, and keeps them out of the payload', async () => {
		const { onConfirm } = setup({ workspaceMembers: new Set(['urn:a:Org']) });
		await pick(A);
		const org = screen.getByRole('checkbox', { name: /Org/ }) as HTMLInputElement;
		expect(org.disabled).toBe(true);
		expect(org.checked).toBe(false);
		expect(screen.getByText('already on workspace')).toBeInTheDocument();
		await fireEvent.click(confirm());
		expect(onConfirm).toHaveBeenCalledWith(['urn:a:Person', 'urn:a:Team']);
	});

	it('select all / none toggles only the enabled rows', async () => {
		setup({ workspaceMembers: new Set(['urn:a:Org']) });
		await pick(A);
		const toggle = screen.getByRole('button', { name: /select none/i });
		await fireEvent.click(toggle);
		expect(rows().filter((r) => !r.disabled).every((r) => !r.checked)).toBe(true);
		expect(confirm()).toBeDisabled();
		await fireEvent.click(screen.getByRole('button', { name: /select all/i }));
		expect(rows().filter((r) => !r.disabled).every((r) => r.checked)).toBe(true);
		expect((screen.getByRole('checkbox', { name: /Org/ }) as HTMLInputElement).checked).toBe(false);
	});

	it('disables confirm with nothing ticked and uses a singular label for one class', async () => {
		setup();
		await pick(B);
		expect(confirm().textContent).toContain('Add 1 class');
		await fireEvent.click(screen.getByRole('checkbox', { name: /Other/ }));
		expect(confirm()).toBeDisabled();
	});

	it('shows an empty state for a namespace with no classes', async () => {
		setup();
		await pick(EMPTY);
		expect(screen.getByText(/no classes in this namespace/i)).toBeInTheDocument();
		expect(confirm()).toBeDisabled();
	});

	it('has confirm disabled before a namespace is chosen', () => {
		setup();
		expect(confirm()).toBeDisabled();
	});

	it('preselects initialNamespaceBaseIri', () => {
		setup({ initialNamespaceBaseIri: B });
		expect(picker().value).toBe(B);
		expect(rows()).toHaveLength(1);
	});

	it('Cancel and Escape close without confirming', async () => {
		const { onConfirm, onClose } = setup();
		await pick(A);
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(onClose).toHaveBeenCalledTimes(1);
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(onClose).toHaveBeenCalledTimes(2);
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('renders nothing when closed', () => {
		setup({ isOpen: false });
		expect(screen.queryByLabelText('Namespace')).toBeNull();
	});
});
