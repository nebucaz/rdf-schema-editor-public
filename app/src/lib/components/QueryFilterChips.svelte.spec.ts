import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import QueryFilterChips from './QueryFilterChips.svelte';
import type { FilterMarker } from '$lib/services/query-column-groups';
import type { Filter } from '$lib/services/query-model';

const f = (id: string, extra: Partial<Filter> = {}): Filter =>
	({ id, hopId: null, propertyIri: `urn:p#${id}`, op: 'eq', value: id, ...extra }) as Filter;
const marker = (filters: Filter[], text: string): FilterMarker => ({
	hopId: null,
	propertyIri: filters[0].propertyIri,
	columnId: null,
	hidden: false,
	filters,
	text
});

function setup(markers: FilterMarker[]) {
	const cb = {
		onEdit: vi.fn(),
		onRemove: vi.fn(),
		onAdd: vi.fn(),
		onGroup: vi.fn(),
		onUngroup: vi.fn(),
		onRemoveFromGroup: vi.fn()
	};
	render(QueryFilterChips, { props: { markers, ...cb } });
	return cb;
}

describe('QueryFilterChips OR grouping', () => {
	it('groups the selected chips by their filter ids', async () => {
		const cb = setup([marker([f('a')], 'A'), marker([f('b')], 'B'), marker([f('c')], 'C')]);
		const group = screen.getByRole('button', { name: /Group as/ });
		expect(group).toBeDisabled();
		await fireEvent.click(screen.getByLabelText('Select filter A'));
		await fireEvent.click(screen.getByLabelText('Select filter C'));
		await fireEvent.click(group);
		expect(cb.onGroup).toHaveBeenCalledWith(['a', 'c']);
	});

	it('draws a group as one block with Ungroup and take-out', async () => {
		const cb = setup([
			marker([f('a', { orGroup: 'g1' })], 'A'),
			marker([f('b')], 'B'),
			marker([f('c', { orGroup: 'g1' })], 'C')
		]);
		expect(screen.getAllByTestId('or-group')).toHaveLength(1);
		await fireEvent.click(screen.getByRole('button', { name: 'Ungroup' }));
		expect(cb.onUngroup).toHaveBeenCalledWith('g1');
		await fireEvent.click(screen.getByRole('button', { name: 'Take A out of the group' }));
		expect(cb.onRemoveFromGroup).toHaveBeenCalledOnce();
	});

	it('does not let a range chip be grouped', () => {
		setup([marker([f('a', { op: 'gte' }), f('a2', { op: 'lt', propertyIri: 'urn:p#a' })], 'A range'), marker([f('b')], 'B')]);
		expect(screen.getByLabelText('Select filter A range')).toBeDisabled();
	});
});
