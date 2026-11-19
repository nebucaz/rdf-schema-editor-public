import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import { namespaceGraphs } from '#lib/config.js';
import { CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI, nodeShapeIri, propertyIri, SKOS } from '#lib/utils/iri.js';
import { buildSchemeConstraintMessage, buildSchemeConstraintSelect } from './concept-property';

const NS = 'http://example.org/ns';
const CORE = 'http://example.org/core';
const graphs = namespaceGraphs(NS);
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;
const device = `${graphs.schema}#Device`;
const lifecycle = `${VOCAB}#Lifecycle`;
const otherScheme = `${VOCAB}#Maturity`;
const prop = propertyIri(device, 'lifecycleStage', graphs.schema);
const shape = nodeShapeIri(device, graphs.shapes);

interface World {
	/** Schemes in the vocab graph, IRI -> label. */
	schemes: Record<string, string>;
	vocabulary: string | null;
	propertyExists: boolean;
	shapeExists: boolean;
	holders: number;
}

function mockFetch(overrides: Partial<World> = {}) {
	const world: World = { schemes: { [lifecycle]: 'Lifecycle', [otherScheme]: 'Maturity' }, vocabulary: CORE, propertyExists: false, shapeExists: true, holders: 0, ...overrides };
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		queries.push(q);
		const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		const rows = (bindings: unknown[]) => json({ head: { vars: [] }, results: { bindings } });
		if (q.includes('SELECT ?g WHERE')) return rows([{ g: { value: graphs.schema } }]);
		if (q.includes('vocabularyNamespace')) return rows(world.vocabulary ? [{ ns: { value: world.vocabulary } }] : []);
		if (q.includes(`<${SKOS.ConceptScheme}>`) && q.includes('SELECT')) {
			const hit = Object.entries(world.schemes).find(([iri]) => q.includes(`<${iri}>`));
			return rows(hit ? [{ label: { value: hit[1] } }] : []);
		}
		if (q.includes('COUNT')) return rows([{ n: { value: String(world.holders) } }]);
		if (q.includes('ASK') && q.includes('owl:DatatypeProperty')) return json({ boolean: world.propertyExists });
		if (q.includes('ASK') && q.includes('sh:NodeShape')) return json({ boolean: world.shapeExists });
		return json({ boolean: false });
	});
	vi.stubGlobal('fetch', fn);
	return { updates, queries, fn };
}
const connector = () => new SparqlConnector('/api/sparql');
afterEach(() => vi.unstubAllGlobals());

describe('insertConceptProperty (STORY-435)', () => {
	it('writes the property, the sh:property entry with the marker and the generated sh:sparql in the source class namespace graphs', async () => {
		const { updates } = mockFetch();
		const result = await connector().insertConceptProperty(device, 'lifecycleStage', lifecycle, true, false);
		expect(result.iri).toBe(prop);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain('INSERT DATA');
		expect(u).toContain(`GRAPH <${graphs.schema}>`);
		expect(u).toContain(`GRAPH <${graphs.shapes}>`);
		expect(u).toContain(`<${prop}> a owl:ObjectProperty`);
		expect(u).toContain(`rdfs:domain <${device}>`);
		expect(u).toContain('rdfs:label "lifecycleStage"');
		expect(u).not.toContain('rdfs:range');
		expect(u).not.toContain('sh:class');
		expect(u).toContain(`<${shape}> sh:property [`);
		expect(u).toContain(`sh:path <${prop}>`);
		expect(u).toContain('sh:name "lifecycleStage"');
		expect(u).toContain('sh:minCount 1');
		expect(u).toContain('sh:maxCount 1');
		expect(u).toContain(`<${CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI}> <${lifecycle}>`);
		expect(u).toContain("sh:sparql [");
		expect(u).toContain('a sh:SPARQLConstraint');
	});

	it('stores exactly the generated select and message', async () => {
		const { updates } = mockFetch();
		await connector().insertConceptProperty(device, 'lifecycleStage', lifecycle, false, true);
		const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
		expect(updates[0]).toContain(`sh:select "${escape(buildSchemeConstraintSelect(prop, lifecycle))}"`);
		expect(updates[0]).toContain(`sh:message "${buildSchemeConstraintMessage('lifecycleStage', 'Lifecycle')}"`);
		expect(updates[0]).not.toContain('sh:minCount');
		expect(updates[0]).not.toContain('sh:maxCount');
	});

	it('creates the NodeShape when the class has none', async () => {
		const { updates } = mockFetch({ shapeExists: false });
		await connector().insertConceptProperty(device, 'lifecycleStage', lifecycle, false, true);
		expect(updates).toHaveLength(2);
		expect(updates[0]).toContain(`<${shape}> a sh:NodeShape ; sh:targetClass <${device}>`);
	});

	it('rejects unsafe IRIs and an empty name before any request', async () => {
		const { fn } = mockFetch();
		await expect(connector().insertConceptProperty('http://x/> } DROP', 'a', lifecycle, false, true)).rejects.toThrow();
		await expect(connector().insertConceptProperty(device, 'a', 'http://x/> } DROP', false, true)).rejects.toThrow();
		await expect(connector().insertConceptProperty(device, '  ', lifecycle, false, true)).rejects.toThrow(/name/i);
		expect(fn).not.toHaveBeenCalled();
	});

	it('rejects a scheme that is not in the vocabulary, and a repository without a vocabulary namespace, with no write', async () => {
		const unknown = mockFetch();
		await expect(connector().insertConceptProperty(device, 'x', `${VOCAB}#Nope`, false, true)).rejects.toThrow(/scheme/i);
		expect(unknown.updates).toHaveLength(0);
		const none = mockFetch({ vocabulary: null });
		await expect(connector().insertConceptProperty(device, 'x', lifecycle, false, true)).rejects.toThrow(/vocabulary/i);
		expect(none.updates).toHaveLength(0);
	});

	it('rejects a duplicate name on the class', async () => {
		const { updates } = mockFetch({ propertyExists: true });
		await expect(connector().insertConceptProperty(device, 'lifecycleStage', lifecycle, false, true)).rejects.toThrow(/already exists/);
		expect(updates).toHaveLength(0);
	});

	it('counts as a write', async () => {
		mockFetch();
		const c = connector();
		const before = c.writeCount;
		await c.insertConceptProperty(device, 'lifecycleStage', lifecycle, false, true);
		expect(c.writeCount).toBe(before + 1);
	});
});

describe('updateConceptProperty (STORY-435)', () => {
	it('replaces marker and select together in one update and leaves no old sh:sparql node', async () => {
		const { updates } = mockFetch();
		await connector().updateConceptProperty(device, prop, { name: 'lifecycleStage', schemeIri: otherScheme, required: false, repeatable: true });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
		expect(u).toContain(`sh:select "${escape(buildSchemeConstraintSelect(prop, otherScheme))}"`);
		expect(u).toContain(`<${CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI}> <${otherScheme}>`);
		// the old node is deleted (matched by the property in its select), not added to
		expect(u).toMatch(/DELETE\s*\{[^}]*\?sc \?scP \?scO/s);
		expect(u).toContain(`CONTAINS(STR(?sel), "$this <${prop}> ?value")`);
		expect(u).toContain(`<${CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI}> ?oldScheme`);
		expect(u).not.toContain('rdfs:range');
	});

	it('changes the name, cardinality and message but never the IRI', async () => {
		const { updates } = mockFetch();
		await connector().updateConceptProperty(device, prop, { name: 'stage', schemeIri: lifecycle, required: true, repeatable: false });
		const u = updates[0];
		expect(u).toContain('rdfs:label "stage"');
		expect(u).toContain('sh:name "stage"');
		expect(u).toContain('?propShape sh:minCount 1');
		expect(u).toContain('?propShape sh:maxCount 1');
		expect(u).toContain(`sh:message "${buildSchemeConstraintMessage('stage', 'Lifecycle')}"`);
		expect(u).toContain(`sh:select "`);
		expect(u).not.toMatch(/stageStage|DeviceStage/);
	});

	it('rejects an unknown scheme and unsafe IRIs with no write', async () => {
		const { updates } = mockFetch();
		await expect(connector().updateConceptProperty(device, prop, { name: 'a', schemeIri: `${VOCAB}#Nope`, required: false, repeatable: true })).rejects.toThrow(/scheme/i);
		await expect(connector().updateConceptProperty(device, 'http://x/> }', { name: 'a', schemeIri: lifecycle, required: false, repeatable: true })).rejects.toThrow();
		expect(updates).toHaveLength(0);
	});
});

describe('deleteConceptProperty (STORY-435)', () => {
	it('refuses while individuals hold a value and reports how many', async () => {
		const { updates } = mockFetch({ holders: 3 });
		const result = await connector().deleteConceptProperty(device, prop);
		expect(result).toEqual({ deleted: false, valueCount: 3 });
		expect(updates).toHaveLength(0);
	});

	it('deletes the property, its sh:property node and its sh:sparql node when nobody holds a value', async () => {
		const { updates } = mockFetch({ holders: 0 });
		const result = await connector().deleteConceptProperty(device, prop);
		expect(result).toEqual({ deleted: true, valueCount: 0 });
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`<${shape}> sh:property ?propShape . ?propShape sh:path <${prop}>`);
		expect(u).toContain(`CONTAINS(STR(?sel), "$this <${prop}> ?value")`);
		expect(u).toContain(`<${prop}> ?p ?o`);
	});

	it('proceeds with { force: true }', async () => {
		const { updates } = mockFetch({ holders: 3 });
		const result = await connector().deleteConceptProperty(device, prop, { force: true });
		expect(result).toEqual({ deleted: true, valueCount: 3 });
		expect(updates).toHaveLength(1);
	});
});
