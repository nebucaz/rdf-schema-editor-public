import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import type { FetchedAssertion } from '#lib/services/sparql-connector.js';

const REL = 'urn:core#consumes';
const OBJECT = 'urn:api#1';
const CLASS = 'urn:core#App';

const mocks = vi.hoisted(() => ({
	connector: {
		fetchResourcePage: vi.fn(),
		fetchAssertionsForIndividual: vi.fn(),
		fetchIndividualAttributeValues: vi.fn(),
		fetchIndividualsOfClass: vi.fn(),
		fetchRelationPredicateOptions: vi.fn(),
		fetchNameableEntities: vi.fn(),
		insertAssertion: vi.fn(),
		deleteAssertion: vi.fn(),
		renameIndividual: vi.fn(),
		applyAttributeSubmissions: vi.fn(),
		changeIndividualClass: vi.fn()
	},
	ensureSchema: vi.fn()
}));

vi.mock('#lib/services/sparql-connector.js', () => ({ sparqlConnector: mocks.connector }));
vi.mock('#lib/stores/schema-store.js', () => ({ schemaStore: { ensureLoaded: mocks.ensureSchema } }));
vi.mock('#lib/stores/namespace-store.svelte.js', () => ({
	namespaceStore: { namespaces: [], ensureLoaded: () => Promise.resolve() }
}));
vi.mock('#lib/utils/identity-schema-index.js', async (orig) => ({
	...(await orig<typeof import('#lib/utils/identity-schema-index.js')>()),
	buildEntityNodeIndex: () =>
		new Map([
			[
				CLASS,
				{
					iri: CLASS,
					name: 'App',
					namespace: 'urn:core#',
					attributes: [],
					labelRequired: false,
					conceptFields: [],
					relationFields: [
						{ iri: REL, name: 'consumes', targetClassIri: 'urn:core#Api', targetClassName: 'Api', repeatable: true, required: false }
					]
				}
			]
		])
}));

import IdentityEditDialog from './IdentityEditDialog.svelte';

const assertion: FetchedAssertion = {
	individualIri: 'urn:app#1',
	predicateIri: REL,
	predicateLabel: 'consumes',
	objectIri: OBJECT,
	objectLabel: 'Billing API'
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.ensureSchema.mockResolvedValue({});
	mocks.connector.fetchResourcePage.mockResolvedValue({
		outgoing: [
			{ predicateIri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type', predicateLabel: 'type', object: CLASS, objectType: 'uri' },
			{ predicateIri: 'http://www.w3.org/2000/01/rdf-schema#label', predicateLabel: 'label', object: 'Backend', objectType: 'literal' }
		],
		incoming: []
	});
	mocks.connector.fetchAssertionsForIndividual.mockResolvedValue([assertion]);
	mocks.connector.fetchIndividualAttributeValues.mockResolvedValue({});
	mocks.connector.fetchIndividualsOfClass.mockResolvedValue([{ iri: OBJECT, label: 'Billing API', namespaceBaseIri: 'urn:api#' }]);
	mocks.connector.fetchRelationPredicateOptions.mockResolvedValue([]);
	mocks.connector.fetchNameableEntities.mockResolvedValue([]);
});

describe('IdentityEditDialog', () => {
	it('keeps two same-label relation targets distinct in the picker', async () => {
		mocks.connector.fetchAssertionsForIndividual.mockResolvedValue([]);
		mocks.connector.fetchIndividualsOfClass.mockResolvedValue([
			{ iri: 'urn:api#1', label: 'Public API', namespaceBaseIri: 'urn:api#' },
			{ iri: 'urn:api#2', label: 'Public API', namespaceBaseIri: 'urn:api#' }
		]);
		const { container } = render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose: () => {} } });
		await screen.findByRole('button', { name: 'Save' });
		const labels = [...container.ownerDocument.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
		expect(new Set(labels).size).toBe(2);
	});

	it('mounts the form only after assertions have loaded, then shows the relation', async () => {
		let resolve!: (a: FetchedAssertion[]) => void;
		mocks.connector.fetchAssertionsForIndividual.mockReturnValueOnce(new Promise((r) => (resolve = r)));
		render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose: () => {} } });
		await screen.findByText('Loading…');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		resolve([assertion]);
		await screen.findByRole('button', { name: 'Save' });
		expect(screen.getByText(/Billing API/)).toBeTruthy();
	});

	it('shows the class selector by default and hides it when allowClassChange is false', async () => {
		const a = render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose: () => {} } });
		await screen.findByRole('button', { name: 'Save' });
		expect(screen.queryByLabelText(/class/i)).not.toBeNull();
		a.unmount();
		render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose: () => {}, allowClassChange: false } });
		await screen.findByRole('button', { name: 'Save' });
		expect(screen.queryByLabelText(/class/i)).toBeNull();
	});

	it('removes a relation immediately and fires the host hook', async () => {
		const onRelationRemoved = vi.fn();
		render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose: () => {}, hooks: { onRelationRemoved } } });
		await screen.findByRole('button', { name: 'Save' });
		await fireEvent.click(screen.getByRole('button', { name: /^Remove consumes/ }));
		await waitFor(() => expect(mocks.connector.deleteAssertion).toHaveBeenCalledWith('urn:app#1', REL, OBJECT));
		expect(onRelationRemoved).toHaveBeenCalledWith('urn:app#1', REL, OBJECT);
	});

	it('renames only when the label changed, fires onRenamed and onSaved, then closes', async () => {
		const onRenamed = vi.fn();
		const onSaved = vi.fn();
		const onClose = vi.fn();
		render(IdentityEditDialog, { props: { iri: 'urn:app#1', onClose, onSaved, hooks: { onRenamed } } });
		await screen.findByRole('button', { name: 'Save' });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(mocks.connector.renameIndividual).not.toHaveBeenCalled();
		expect(onSaved).toHaveBeenCalledWith({ label: 'Backend', classIri: undefined });
	});
});
