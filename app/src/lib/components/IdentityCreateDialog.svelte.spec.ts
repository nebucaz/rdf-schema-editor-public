import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const CLASS = 'urn:core#App';

const mocks = vi.hoisted(() => ({
	connector: { fetchIndividualsOfClass: vi.fn(), resolveEffectiveClassNamespace: vi.fn(), insertIndividual: vi.fn() },
	ensureSchema: vi.fn()
}));

vi.mock('#lib/services/sparql-connector.js', () => ({ sparqlConnector: mocks.connector }));
vi.mock('#lib/stores/schema-store.js', () => ({ schemaStore: { ensureLoaded: mocks.ensureSchema } }));
vi.mock('#lib/stores/namespace-store.svelte.js', () => ({
	namespaceStore: {
		namespaces: [{ baseIri: 'urn:core', prefix: 'core', description: '' }],
		ensureLoaded: () => Promise.resolve()
	}
}));
vi.mock('#lib/utils/identity-schema-index.js', async (orig) => ({
	...(await orig<typeof import('#lib/utils/identity-schema-index.js')>()),
	buildEntityNodeIndex: () =>
		new Map([[CLASS, { iri: CLASS, name: 'App', namespace: 'urn:core', attributes: [], labelRequired: false, relationFields: [], conceptFields: [] }]])
}));

import IdentityCreateDialog from './IdentityCreateDialog.svelte';

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensureSchema.mockResolvedValue({});
	mocks.connector.resolveEffectiveClassNamespace.mockResolvedValue({ baseIri: 'urn:concept', own: true });
	mocks.connector.insertIndividual.mockResolvedValue({ iri: 'urn:concept#new' });
});

async function fillAndSubmit(label: string) {
	await screen.findByRole('button', { name: 'Add' });
	await fireEvent.input(screen.getByLabelText(/^Label/), { target: { value: label } });
	await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

describe('IdentityCreateDialog', () => {
	it('shows Loading until the default namespace resolved, titled after the class', async () => {
		let resolve!: (v: { baseIri: string; own: boolean }) => void;
		mocks.connector.resolveEffectiveClassNamespace.mockReturnValueOnce(new Promise((r) => (resolve = r)));
		render(IdentityCreateDialog, { props: { classIri: CLASS, onClose: () => {} } });
		await screen.findByText('Loading…');
		expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
		resolve({ baseIri: 'urn:concept', own: true });
		await screen.findByRole('button', { name: 'Add' });
		expect(screen.getByText('Add core:App Identity')).toBeTruthy();
	});

	it('creates in the resolved namespace; hooks.onCreated runs before the host onCreated', async () => {
		const order: string[] = [];
		const onCreated = vi.fn(() => void order.push('host'));
		const onClose = vi.fn();
		render(IdentityCreateDialog, {
			props: { classIri: CLASS, onClose, onCreated, hooks: { onCreated: () => void order.push('hook') } }
		});
		await fillAndSubmit('Billing');
		await waitFor(() => expect(onCreated).toHaveBeenCalledWith('urn:concept#new', 'Billing'));
		expect(mocks.connector.insertIndividual).toHaveBeenCalledWith(CLASS, 'Billing', 'urn:concept', undefined);
		expect(order).toEqual(['hook', 'host']);
		expect(onClose).toHaveBeenCalled();
	});

	it('shows a duplicate-label error inline without closing', async () => {
		mocks.connector.insertIndividual.mockRejectedValueOnce(new Error('already exists'));
		const onClose = vi.fn();
		render(IdentityCreateDialog, { props: { classIri: CLASS, onClose } });
		await fillAndSubmit('Billing');
		await screen.findByText(/already exists/);
		expect(onClose).not.toHaveBeenCalled();
	});
});
