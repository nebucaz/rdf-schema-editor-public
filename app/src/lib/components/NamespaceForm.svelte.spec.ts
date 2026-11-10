import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import NamespaceForm from './NamespaceForm.svelte';

describe('NamespaceForm vocabulary marker (ontology-pipeline STORY-321)', () => {
	const edit = (props: Record<string, unknown> = {}) => {
		const onSubmit = vi.fn(async () => {});
		render(NamespaceForm, {
			props: { mode: 'edit', initialPrefix: 'core', initialBaseIri: 'http://example.org/core', submitLabel: 'Save', onSubmit, onCancel: () => {}, ...props }
		});
		return onSubmit;
	};

	it('offers the vocabulary checkbox when editing, unchecked by default', () => {
		edit();
		const box = screen.getByRole('checkbox', { name: /vocabulary namespace/i }) as HTMLInputElement;
		expect(box.checked).toBe(false);
	});

	it('does not offer it when creating', () => {
		render(NamespaceForm, { props: { mode: 'create', submitLabel: 'Create', onSubmit: async () => {}, onCancel: () => {} } });
		expect(screen.queryByRole('checkbox', { name: /vocabulary namespace/i })).toBeNull();
	});

	it('submits the chosen value', async () => {
		const onSubmit = edit({ initialVocabulary: false });
		await fireEvent.click(screen.getByRole('checkbox', { name: /vocabulary namespace/i }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ vocabulary: true }));
	});

	it('shows the error when the connector refuses a second marked namespace', async () => {
		const onSubmit = edit({ onSubmit: vi.fn(async () => { throw new Error('Another namespace is already the vocabulary namespace'); }) });
		void onSubmit;
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText(/already the vocabulary namespace/)).toBeTruthy();
	});
});

describe('NamespaceForm pipeline flag', () => {
	it('is off by default, also when creating', async () => {
		const onSubmit = vi.fn(async () => {});
		render(NamespaceForm, { props: { mode: 'create', initialPrefix: 'a', initialBaseIri: 'http://x/a', submitLabel: 'Create', onSubmit, onCancel: () => {} } });
		const box = screen.getByRole('checkbox', { name: /ontology pipeline/i }) as HTMLInputElement;
		expect(box.checked).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: 'Create' }));
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ pipeline: false }));
	});

	it('submits the chosen value', async () => {
		const onSubmit = vi.fn(async () => {});
		render(NamespaceForm, { props: { mode: 'edit', initialPrefix: 'a', initialBaseIri: 'http://x/a', submitLabel: 'Save', onSubmit, onCancel: () => {} } });
		await fireEvent.click(screen.getByRole('checkbox', { name: /ontology pipeline/i }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ pipeline: true }));
	});
});
