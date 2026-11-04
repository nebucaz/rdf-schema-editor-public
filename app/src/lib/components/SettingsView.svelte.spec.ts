import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
	ensureSchema: vi.fn(),
	fullLoad: vi.fn(),
	declaredObjectProperties: vi.fn()
}));

vi.mock('#lib/stores/schema-store.js', () => ({ schemaStore: { ensureLoaded: mocks.ensureSchema } }));
vi.mock('#lib/services/sparql-connector.js', () => ({
	sparqlConnector: {
		fetchFullSchemaForAllNamespaces: mocks.fullLoad,
		fetchAllDeclaredObjectProperties: mocks.declaredObjectProperties
	}
}));
vi.mock('#lib/stores/settings-store.svelte.js', () => ({
	settingsStore: {
		loading: false,
		saving: false,
		authoritativeEntityClassIri: null,
		representsPredicateIri: null,
		ensureLoaded: vi.fn(async () => {})
	}
}));
vi.mock('#lib/stores/namespace-store.svelte.js', () => ({
	namespaceStore: {
		namespaces: [{ baseIri: 'http://example.org/org', prefix: 'org', description: '' }],
		ensureLoaded: vi.fn(async () => {})
	}
}));

import SettingsView from './SettingsView.svelte';

describe('SettingsView schema loading (reduce-requests STORY-302)', () => {
	beforeEach(() => {
		mocks.ensureSchema.mockReset().mockResolvedValue({
			classes: [
				{ iri: 'http://example.org/org#Team', label: 'Team', comment: null, namespaceBaseIri: 'http://example.org/org' }
			],
			datatypeProperties: [],
			objectProperties: [],
			subClassOf: [],
			individuals: [],
			individualClassRelations: [],
			individualIndividualRelations: []
		});
		mocks.fullLoad.mockReset();
		mocks.declaredObjectProperties.mockReset().mockResolvedValue([]);
	});

	it('takes the classes from the shared schema-only copy instead of a full load', async () => {
		render(SettingsView);
		expect(await screen.findByText('[org] Team')).toBeInTheDocument();
		expect(mocks.ensureSchema).toHaveBeenCalledWith('schema');
		expect(mocks.fullLoad).not.toHaveBeenCalled();
	});
});
