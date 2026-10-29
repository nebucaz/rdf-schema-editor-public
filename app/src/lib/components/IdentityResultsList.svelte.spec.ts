import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import IdentityResultsList from './IdentityResultsList.svelte';

const results = [
	{ iri: 'urn:a', classIri: '', label: 'Alpha', namespaceBaseIri: 'urn:ns', syncSource: null, syncStatus: null },
	{ iri: 'urn:b', classIri: '', label: 'Beta', namespaceBaseIri: 'urn:ns', syncSource: null, syncStatus: null }
];
const props = { results, hasSearched: true, hasMore: false, classes: [], namespaces: [], onSelect: vi.fn(), onLoadMore: vi.fn() };

describe('IdentityResultsList selection', () => {
	it('has no checkboxes unless selectable', () => {
		render(IdentityResultsList, { props });
		expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
	});

	it('shows a checkbox per row, reflects the checked set and reports toggles', async () => {
		const onToggleChecked = vi.fn();
		render(IdentityResultsList, { props: { ...props, selectable: true, checkedIris: new Set(['urn:b']), onToggleChecked } });
		expect((screen.getByLabelText('Select Alpha') as HTMLInputElement).checked).toBe(false);
		expect((screen.getByLabelText('Select Beta') as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByLabelText('Select Alpha'));
		expect(onToggleChecked).toHaveBeenCalledWith('urn:a');
		expect(props.onSelect).not.toHaveBeenCalled();
	});
});
