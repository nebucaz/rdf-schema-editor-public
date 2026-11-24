import { describe, expect, it, vi } from 'vitest';
import { loadAssertionOptions } from './assertion-options.js';
import type { FetchedSchema } from './sparql-connector.js';

const schema = { marker: 'loaded' } as unknown as FetchedSchema;

function deps() {
	return {
		connector: {
			fetchRelationPredicateOptions: vi.fn(async (_s?: FetchedSchema) => [{ iri: 'urn:p', label: 'p' }]),
			fetchNameableEntities: vi.fn(async (_s?: FetchedSchema) => [
				{ iri: 'urn:a', label: 'Same', kind: 'individual' },
				{ iri: 'urn:b', label: 'Same', kind: 'individual' }
			])
		},
		getSchema: vi.fn(async () => schema)
	};
}

describe('loadAssertionOptions', () => {
	it('passes the loaded schema to both option loaders (no per-namespace reload)', async () => {
		const d = deps();
		await loadAssertionOptions(d.connector as never, d.getSchema);
		expect(d.getSchema).toHaveBeenCalledTimes(1);
		expect(d.connector.fetchRelationPredicateOptions).toHaveBeenCalledWith(schema);
		expect(d.connector.fetchNameableEntities).toHaveBeenCalledWith(schema);
	});

	it('returns predicate options and disambiguated object options', async () => {
		const d = deps();
		const r = await loadAssertionOptions(d.connector as never, d.getSchema);
		expect(r.predicateOptions).toEqual([{ iri: 'urn:p', label: 'p' }]);
		expect(new Set(r.objectOptions.map((o) => o.label)).size).toBe(2);
	});

	it('propagates a failed load so the caller can retry', async () => {
		const d = deps();
		d.getSchema.mockRejectedValueOnce(new Error('boom'));
		await expect(loadAssertionOptions(d.connector as never, d.getSchema)).rejects.toThrow('boom');
		await expect(loadAssertionOptions(d.connector as never, d.getSchema)).resolves.toBeDefined();
	});
});
