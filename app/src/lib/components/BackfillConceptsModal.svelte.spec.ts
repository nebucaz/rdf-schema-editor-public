import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import BackfillConceptsModal from './BackfillConceptsModal.svelte';
import type { BackfillProposal } from '#lib/services/concept-backfill.js';

const proposals: BackfillProposal[] = [
	{ classIri: 'urn:c:Order', namespaceBaseIri: 'http://e/gov', label: 'Order', definition: 'A purchase request.', action: 'create', conceptIri: 'urn:v:Order' },
	{ classIri: 'urn:c:Client', namespaceBaseIri: 'http://e/gov', label: 'Client', definition: '', action: 'link', conceptIri: 'urn:v:Customer' }
];
const titles = new Map([['urn:v:Customer', 'Customer']]);

function setup(over: Record<string, unknown> = {}) {
	const onAccept = vi.fn(async () => {});
	const onClose = vi.fn();
	render(BackfillConceptsModal, { props: { isOpen: true, proposals, conceptTitles: titles, onAccept, onClose, ...over } });
	return { onAccept, onClose };
}

const row = (label: string) => screen.getByText(label, { selector: 'td.class-label' }).closest('tr') as HTMLElement;

describe('BackfillConceptsModal (STORY-326)', () => {
	it('lists every proposal with what accepting it will do', () => {
		setup();
		expect(within(row('Order')).getByText('Create concept')).toBeTruthy();
		expect(within(row('Client')).getByText(/Link to Customer/)).toBeTruthy();
	});

	it('lets the label and definition be edited before accepting one row', async () => {
		const { onAccept } = setup();
		const order = row('Order');
		await fireEvent.input(within(order).getByLabelText('Label for Order'), { target: { value: 'Purchase order' } });
		await fireEvent.input(within(order).getByLabelText('Definition for Order'), { target: { value: 'A binding request.' } });
		await fireEvent.click(within(order).getByRole('button', { name: 'Accept' }));
		expect(onAccept).toHaveBeenCalledWith([
			{ classIri: 'urn:c:Order', namespaceBaseIri: 'http://e/gov', label: 'Purchase order', definition: 'A binding request.' }
		]);
	});

	it('accepts all rows at once', async () => {
		const { onAccept } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
		const rows = (onAccept.mock.calls[0] as unknown as [{ classIri: string }[]])[0];
		expect(rows.map((r) => r.classIri)).toEqual(['urn:c:Order', 'urn:c:Client']);
	});

	it('drops accepted rows from the list', async () => {
		setup();
		await fireEvent.click(within(row('Order')).getByRole('button', { name: 'Accept' }));
		expect(await screen.findByText('Client', { selector: 'td.class-label' })).toBeTruthy();
		expect(screen.queryByText('Order', { selector: 'td.class-label' })).toBeNull();
	});

	it('keeps the rows and shows the message when accepting fails', async () => {
		const onAccept = vi.fn(async () => {
			throw new Error('Order: Preferred label must not contain parentheses');
		});
		setup({ onAccept });
		await fireEvent.click(screen.getByRole('button', { name: 'Accept all' }));
		expect(await screen.findByText(/must not contain parentheses/)).toBeTruthy();
		expect(screen.getByText('Order', { selector: 'td.class-label' })).toBeTruthy();
	});

	it('says so when every class already has a concept', () => {
		setup({ proposals: [] });
		expect(screen.getByText('Every class already has a concept.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Accept all' })).toBeNull();
	});

	it('closes', async () => {
		const { onClose } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(onClose).toHaveBeenCalled();
	});
});
