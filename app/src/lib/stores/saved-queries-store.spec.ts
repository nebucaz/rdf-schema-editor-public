import { describe, it, expect, vi } from 'vitest';
import { SavedQueriesStore } from './saved-queries-store.svelte';
import { startQueryFromClass, addColumn } from '../services/query-model-edit';
import { buildBuilderSchema } from '../services/query-builder-schema';
import { parseQueryModel } from '../services/query-model';
import type { FetchedSavedQuery, FetchedSchema } from '../services/sparql-connector';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;
const schema = buildBuilderSchema({
	classes: [{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [],
	individualClassRelations: [], individualIndividualRelations: []
} as FetchedSchema);
const model = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'Name' });
const user = { sub: 'u1', displayName: 'Una' };

function fake(initial: FetchedSavedQuery[] = []) {
	let rows = [...initial];
	return {
		fetchSavedQueries: vi.fn(async () => rows),
		insertSavedQuery: vi.fn(async (name: string, text: string, description?: string, wb?: { queryModelJson: string; createdBy: string }) => {
			const iri = `http://x#SavedQuery${name}`;
			rows.push({ iri, label: name, sparqlText: text, description: description ?? '', queryModel: wb?.queryModelJson, createdBy: wb?.createdBy, published: false });
			return iri;
		}),
		renameSavedQuery: vi.fn(async (iri: string, name: string) => {
			rows = rows.map((r) => (r.iri === iri ? { ...r, label: name } : r));
		}),
		deleteSavedQuery: vi.fn(async (iri: string) => {
			rows = rows.filter((r) => r.iri !== iri);
		})
	};
}

describe('SavedQueriesStore', () => {
	it('save stores the model JSON, compiled SPARQL and creator, then lists it', async () => {
		const c = fake();
		const store = new SavedQueriesStore(c);
		await store.save({ name: 'Apps', description: 'all', model, schema, user });
		const [name, text, desc, wb] = c.insertSavedQuery.mock.calls[0];
		expect(name).toBe('Apps');
		expect(text).toContain('SELECT');
		expect(desc).toBe('all');
		expect(wb?.createdBy).toBe('u1');
		const parsed = parseQueryModel(wb!.queryModelJson);
		expect(parsed.ok && parsed.model).toEqual(model);
		expect(store.items.map((i) => i.label)).toEqual(['Apps']);
		expect(store.items[0].kind).toBe('builder');
	});

	it('save without a user identity is rejected and writes nothing', async () => {
		const c = fake();
		const store = new SavedQueriesStore(c);
		await store.save({ name: 'x', model, schema, user: null });
		expect(c.insertSavedQuery).not.toHaveBeenCalled();
		expect(store.error).toMatch(/identity/i);
	});

	it('surfaces a duplicate-name failure without losing the list', async () => {
		const c = fake();
		c.insertSavedQuery.mockRejectedValueOnce(new Error('already exists'));
		const store = new SavedQueriesStore(c);
		await store.save({ name: 'x', model, schema, user });
		expect(store.error).toBe('already exists');
	});

	it('rename only calls renameSavedQuery (label), keeping the IRI', async () => {
		const c = fake([{ iri: 'http://x#SQ1', label: 'Old', sparqlText: 'SELECT 1', description: '', published: false }]);
		const store = new SavedQueriesStore(c);
		await store.load(user);
		await store.rename('http://x#SQ1', 'New');
		expect(c.renameSavedQuery).toHaveBeenCalledWith('http://x#SQ1', 'New');
		expect(store.items[0]).toMatchObject({ iri: 'http://x#SQ1', label: 'New' });
	});

	it('remove deletes only the targeted query', async () => {
		const mk = (iri: string): FetchedSavedQuery => ({ iri, label: iri, sparqlText: 'SELECT 1', description: '', published: false });
		const c = fake([mk('http://x#A'), mk('http://x#B')]);
		const store = new SavedQueriesStore(c);
		await store.load(user);
		await store.remove('http://x#A');
		expect(c.deleteSavedQuery).toHaveBeenCalledTimes(1);
		expect(c.deleteSavedQuery).toHaveBeenCalledWith('http://x#A');
		expect(store.items.map((i) => i.iri)).toEqual(['http://x#B']);
	});

	it('lists legacy queries tagged sparql', async () => {
		const c = fake([{ iri: 'http://x#L', label: 'Legacy', sparqlText: 'SELECT 1', description: '', published: false }]);
		const store = new SavedQueriesStore(c);
		await store.load(null);
		expect(store.items[0].kind).toBe('sparql');
	});
});
