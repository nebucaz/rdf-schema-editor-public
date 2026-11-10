import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import PromoteConceptDialog from './PromoteConceptDialog.svelte';
import type { FetchedNamespace } from '#lib/services/sparql-connector.js';

const ns = (baseIri: string, prefix: string, vocabulary = false) =>
	({ baseIri, prefix, description: null, color: null, publisher: null, license: null, locked: false, defaultHidden: false, listedInFilter: true, vocabulary }) as FetchedNamespace;
const namespaces = [ns('http://e/core', 'core', true), ns('http://e/gov', 'gov'), ns('http://e/hr', 'hr')];

describe('PromoteConceptDialog (STORY-326)', () => {
	it('offers every namespace except the vocabulary one and promotes into the chosen one', async () => {
		const onConfirm = vi.fn(async () => {});
		render(PromoteConceptDialog, { props: { conceptTitle: 'Customer', namespaces, onConfirm, onCancel: () => {} } });
		const options = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
		expect(options).toEqual(['http://e/gov', 'http://e/hr']);
		await fireEvent.change(screen.getByLabelText('Namespace'), { target: { value: 'http://e/hr' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
		expect(onConfirm).toHaveBeenCalledWith('http://e/hr');
	});

	it('explains that only the label is used and the definition stays in the vocabulary', () => {
		render(PromoteConceptDialog, { props: { conceptTitle: 'Customer', namespaces, onConfirm: async () => {}, onCancel: () => {} } });
		expect(screen.getByText(/definition stays in the vocabulary/i)).toBeTruthy();
	});

	it('shows the refusal, for example an existing class', async () => {
		const onConfirm = vi.fn(async () => {
			throw new Error('A class named "Customer" already exists');
		});
		render(PromoteConceptDialog, { props: { conceptTitle: 'Customer', namespaces, onConfirm, onCancel: () => {} } });
		await fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
		expect(await screen.findByText(/already exists/)).toBeTruthy();
	});

	it('cannot promote when there is no other namespace', () => {
		render(PromoteConceptDialog, { props: { conceptTitle: 'Customer', namespaces: [namespaces[0]], onConfirm: async () => {}, onCancel: () => {} } });
		expect((screen.getByRole('button', { name: 'Promote' }) as HTMLButtonElement).disabled).toBe(true);
	});
});
