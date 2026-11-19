import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptFieldRow from './ConceptFieldRow.svelte';

const field = {
	iri: 'http://example.org/ns/schema#deviceLifecycleStage', name: 'lifecycleStage', targetClassIri: '', targetClassName: '',
	valueSchemeIri: 'http://example.org/core/vocab#Lifecycle', required: true, repeatable: false
};

describe('ConceptFieldRow (STORY-437)', () => {
	it('shows name → scheme label with a link to the vocabulary', () => {
		render(ConceptFieldRow, { props: { field, schemeName: 'Lifecycle', onEdit: vi.fn(), onDelete: vi.fn() } });
		expect(screen.getByText('lifecycleStage')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'Lifecycle' });
		expect(link.getAttribute('href')).toContain('/vocabulary');
		expect(screen.getByText('→')).toBeTruthy();
	});

	it('falls back to the scheme local name when the scheme is unknown', () => {
		render(ConceptFieldRow, { props: { field, onEdit: vi.fn(), onDelete: vi.fn() } });
		expect(screen.getByRole('link', { name: 'Lifecycle' })).toBeTruthy();
	});

	it('marks required and repeatable like an attribute', () => {
		render(ConceptFieldRow, { props: { field: { ...field, repeatable: true }, schemeName: 'Lifecycle', onEdit: vi.fn(), onDelete: vi.fn() } });
		expect(screen.getByText('!', { exact: false }).textContent).toContain('![]');
	});

	it('edit and delete call back with the field', async () => {
		const onEdit = vi.fn();
		const onDelete = vi.fn();
		render(ConceptFieldRow, { props: { field, schemeName: 'Lifecycle', onEdit, onDelete } });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit lifecycleStage' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete lifecycleStage' }));
		expect(onEdit).toHaveBeenCalledWith(field);
		expect(onDelete).toHaveBeenCalledWith(field);
	});

	it('an inherited field has no actions and says where it comes from', () => {
		const inherited = { ...field, inheritedFrom: { classIri: 'x', className: 'Device' } };
		render(ConceptFieldRow, { props: { field: inherited, schemeName: 'Lifecycle', onEdit: vi.fn(), onDelete: vi.fn() } });
		expect(screen.queryByRole('button', { name: 'Edit lifecycleStage' })).toBeNull();
		expect(screen.getByText('from Device')).toBeTruthy();
	});
});
