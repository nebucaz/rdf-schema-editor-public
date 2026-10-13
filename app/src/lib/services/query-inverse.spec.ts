import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { compileCountQuery, compileQuery } from './query-compiler';
import { emptyQueryModel, validateRunnableQueryModel, type QueryModel } from './query-model';
import { printSplPipeline } from './query-spl';
import { parseSpl } from './query-spl-parser';
import { normaliseModel } from './query-spl-normalise';
import { RDF } from './turtle';
import { buildResultRows } from './query-results';
import { collectFactKeys } from './annotation-badges';
import { decodeModelFromUrl, encodeModelForUrl, parseQueryModel, serializeQueryModel } from './query-model';
import { openSavedQuery, toSavedQueryItem } from './saved-queries';
import { SparqlConnector } from './sparql-connector';
import { ANNOTATION_CLASS_IRI } from '../utils/iri';
import type { SparqlSelectResults } from './sparql-connector';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI, SOC_DATA_NS, SOC_SCHEMA_NS } from './soc-test-support';

/**
 * STORY-227: inverse hops end to end on the SOC schema. The question "which alerts touched web-01?"
 * starts at `Server` and walks the forward chain Alert → Event → LogFile → Server backwards.
 */

const quads = loadSocQuads();
const schema = buildBuilderSchema(buildSocFetchedSchema(quads));
const s = (n: string) => `${SOC_SCHEMA_NS}${n}`;
const OPTS = { namespaces: [SOC_BASE_IRI] };
const PAGE = { limit: 25, offset: 0 };

const inv = (id: string, parent: string | null, p: string, target: string) => ({
	id, parentHopId: parent, propertyIri: s(p), direction: 'inverse' as const, targetClassIri: s(target)
});

/** `Server | ^hostedOn | ^hostedOn.^recordedIn | ^hostedOn.^recordedIn.^triggeredBy`, alert ids of web-01. */
function alertsForServer(): QueryModel {
	return {
		...emptyQueryModel(s('Server'), [SOC_BASE_IRI]),
		hops: [
			inv('h1', null, 'hostedOn', 'LogFile'),
			inv('h2', 'h1', 'recordedIn', 'AuthenticationEvent'),
			inv('h3', 'h2', 'triggeredBy', 'Alert')
		],
		filters: [{ id: 'f1', hopId: null, propertyIri: s('hostname'), op: 'eq', value: 'web-01.example.com' }],
		columns: [
			{ id: 'alertId', hopId: 'h3', source: { propertyIri: s('alertId') }, header: 'alertId' },
			{ id: 'title', hopId: 'h3', source: { propertyIri: s('title') }, header: 'title' }
		]
	};
}

const SPL = [
	'Server',
	'| ^hostedOn',
	'| ^hostedOn.^recordedIn',
	'| ^hostedOn.^recordedIn.^triggeredBy',
	'| where hostname="web-01.example.com"',
	'| fields ^hostedOn.^recordedIn.^triggeredBy.alertId, ^hostedOn.^recordedIn.^triggeredBy.title'
].join('\n');

describe('inverse hops: validate', () => {
	it('is a valid runnable model over the SOC schema', () => {
		expect(validateRunnableQueryModel(alertsForServer(), new Set(schema.classes.keys()), schema)).toEqual([]);
	});
});

describe('inverse hops: compile', () => {
	it('swaps subject and object for every inverse hop, keeping the same entity variables', () => {
		const sparql = compileQuery(alertsForServer(), schema, PAGE).sparql;
		expect(sparql).toContain(`?h0 <${s('hostedOn')}> ?root .`);
		expect(sparql).toContain(`?h1 <${s('recordedIn')}> ?h0 .`);
		expect(sparql).toContain(`?h2 <${s('triggeredBy')}> ?h1 .`);
		expect(sparql).not.toContain(`?root <${s('hostedOn')}>`);
	});

	it('uses only IRIs from the model and the standard vocabularies', () => {
		const sparql = compileQuery(alertsForServer(), schema, PAGE).sparql;
		for (const m of sparql.matchAll(/<([^>]+)>/g)) {
			expect(m[1].startsWith(SOC_BASE_IRI) || m[1].startsWith('http://www.w3.org/'), m[1]).toBe(true);
		}
	});

	it('compiles the count query with the same joins', () => {
		const count = compileCountQuery(alertsForServer(), schema).sparql;
		expect(count).toContain(`?h0 <${s('hostedOn')}> ?root .`);
		expect(count).toContain('COUNT(*)');
	});

	it('compiles a forward hop beyond inverse hops with the forward orientation', () => {
		const m: QueryModel = {
			...emptyQueryModel(s('Server'), [SOC_BASE_IRI]),
			hops: [inv('h1', null, 'hostedOn', 'LogFile'), inv('h2', 'h1', 'recordedIn', 'AuthenticationEvent'),
				{ id: 'h3', parentHopId: 'h2', propertyIri: s('outcome'), direction: 'forward' as const, targetClassIri: s('Outcome') }],
			columns: [{ id: 'o', hopId: 'h3', source: 'label', header: 'Outcome' }]
		};
		const sparql = compileQuery(m, schema, PAGE).sparql;
		expect(sparql).toContain(`?h1 <${s('recordedIn')}> ?h0 .`);
		expect(sparql).toContain(`?h1 <${s('outcome')}> ?h2 .`);
	});

	it('reports a hop with no matching relationship as a compile error', () => {
		const m = alertsForServer();
		m.hops[0] = inv('h1', null, 'hostedOn', 'Alert'); // Alert has no hostedOn
		expect(() => compileQuery(m, schema, PAGE)).toThrow(/Inverse hop h1/);
	});
});

describe('inverse hops: golden result for web-01', () => {
	// Independent of the model: walk the data triples backwards from the server.
	const objectsOf = (p: string, o: string) =>
		quads.filter((q) => q.predicate.value === s(p) && q.object.value === o).map((q) => q.subject.value);
	const valuesOf = (subject: string, p: string) =>
		quads.filter((q) => q.subject.value === subject && q.predicate.value === s(p)).map((q) => q.object.value);

	it('the data has alerts reachable from web-01 only through logfile → event → alert', () => {
		const servers = quads.filter((q) => q.predicate.value === s('hostname') && q.object.value === 'web-01.example.com')
			.map((q) => q.subject.value);
		expect(servers).toEqual([`${SOC_DATA_NS}web-01`]);
		const files = servers.flatMap((sv) => objectsOf('hostedOn', sv));
		const events = files.flatMap((f) => objectsOf('recordedIn', f));
		const alerts = events.flatMap((e) => objectsOf('triggeredBy', e));
		expect(files.length).toBeGreaterThan(0);
		expect(events.length).toBeGreaterThan(0);
		// Every alert so found really is typed Alert and has an alertId.
		const types = quads.filter((q) => q.predicate.value === RDF.type);
		for (const a of alerts) {
			expect(types.some((t) => t.subject.value === a && t.object.value === s('Alert'))).toBe(true);
			expect(valuesOf(a, 'alertId').length).toBe(1);
		}
		expect(new Set(alerts).size).toBeGreaterThan(0);
	});
});

describe('inverse hops: print', () => {
	it('prints ^relationship path segments', () => {
		expect(printSplPipeline(alertsForServer(), schema)).toBe(SPL);
	});
});

describe('inverse hops: parse', () => {
	it('parses the printed pipeline back to the same model', () => {
		const parsed = parseSpl(SPL, schema, OPTS);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(normaliseModel(parsed.model)).toEqual(normaliseModel(alertsForServer()));
	});

	it('round-trips print → parse → print', () => {
		const parsed = parseSpl(printSplPipeline(alertsForServer(), schema), schema, OPTS);
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(printSplPipeline(parsed.model, schema)).toBe(SPL);
	});

	it('rejects ^ on a relationship nothing inbound matches, with a positioned error', () => {
		const r = parseSpl('Server\n| ^triggeredBy', schema, OPTS);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.message).toMatch(/triggeredBy/);
			expect(r.error.start).toBeGreaterThan(0);
		}
	});

	it('does not resolve a forward name through ^, nor an inverse through the plain label', () => {
		expect(parseSpl('Server\n| hostedOn', schema, OPTS).ok).toBe(false);
		expect(parseSpl('Log file\n| ^hostedOn', schema, OPTS).ok).toBe(false);
	});

	it('requires an inverse hop to be expanded before a field can use it', () => {
		const r = parseSpl('Server\n| fields ^hostedOn.path', schema, OPTS);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toMatch(/not expanded/);
	});

	it('keeps a forward hop and an inverse hop over different properties side by side', () => {
		const r = parseSpl('Log file\n| hostedOn\n| ^recordedIn\n| fields path', schema, OPTS);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.model.hops.map((h) => h.direction)).toEqual(['forward', 'inverse']);
	});
});

describe('inverse hops: facts and annotations (STORY-228 audit)', () => {
	afterEach(() => vi.unstubAllGlobals());

	/** A one-row result for the alerts query with each column bound to its entity's own IRIs. */
	function alertRows() {
		const model = alertsForServer();
		const compiled = compileQuery(model, schema, PAGE);
		const alertIri = `${SOC_DATA_NS}alert-1`;
		const bindings: Record<string, { type: 'uri' | 'literal'; value: string }> = {
			[compiled.entityVariables.root]: { type: 'uri', value: `${SOC_DATA_NS}web-01` },
			[compiled.entityVariables.h1]: { type: 'uri', value: `${SOC_DATA_NS}web-01-auth-log` },
			[compiled.entityVariables.h2]: { type: 'uri', value: `${SOC_DATA_NS}event-1` },
			[compiled.entityVariables.h3]: { type: 'uri', value: alertIri }
		};
		for (const c of compiled.columns) bindings[c.variable] = { type: 'literal', value: `v-${c.id}` };
		const results: SparqlSelectResults = { head: { vars: Object.keys(bindings) }, results: { bindings: [bindings] } };
		return { model, compiled, results, alertIri };
	}

	it('maps a property cell on an inverse-hop entity to (that entity, property, value)', () => {
		const { model, compiled, results, alertIri } = alertRows();
		const [alertId] = buildResultRows(model, compiled, results).rows[0];
		expect(alertId.fact).toEqual({
			subjectIri: alertIri,
			predicateIri: s('alertId'),
			object: { value: 'v-alertId', isIri: false }
		});
		// Never the root server the hop was reached from.
		expect(alertId.fact?.subjectIri).not.toContain('web-01');
	});

	it('collects one batched fact key per inverse-hop cell', () => {
		const { model, compiled, results, alertIri } = alertRows();
		const keys = collectFactKeys(buildResultRows(model, compiled, results));
		expect(keys.map((k) => [k.subjectIri, k.predicateIri])).toEqual([
			[alertIri, s('alertId')],
			[alertIri, s('title')]
		]);
	});

	it('adds and removes an annotation on such a cell through the connector', async () => {
		const { model, compiled, results } = alertRows();
		const [fact] = collectFactKeys(buildResultRows(model, compiled, results));
		const updates: string[] = [];
		const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, o: { body: string }) => {
				const body = JSON.parse(o.body);
				if (body.update !== undefined) {
					updates.push(body.update as string);
					return json({ success: true });
				}
				const q: string = body.query;
				if (q.includes('ASK')) return json({ head: {}, boolean: true });
				if (q.includes('GRAPH ?g') && q.includes('a ?type'))
					return json({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: SOC_BASE_IRI } }] } });
				return json({ head: { vars: [] }, results: { bindings: [] } });
			})
		);
		const c = new SparqlConnector('/api/sparql');
		const iri = await c.addAnnotation(fact, { type: 'text', text: 'checked' }, { annotatedBy: 'a', annotatedAt: '2026-10-12T00:00:00.000Z' });
		const insert = updates.find((u) => u.includes(`a <${ANNOTATION_CLASS_IRI}>`))!;
		expect(insert).toContain(`<${iri}> a <${ANNOTATION_CLASS_IRI}>`);
		// The reified statement carries the inverse-hop entity as its subject, not the root server.
		const statement = updates.find((u) => u.includes('a rdf:Statement'))!;
		expect(statement).toContain(`rdf:subject <${fact.subjectIri}>`);
		expect(statement).toContain(`rdf:predicate <${fact.predicateIri}>`);
		await c.deleteAnnotation(iri);
		expect(updates.at(-1)).toContain(`<${iri}>`);
	});
});

describe('inverse hops: share links and saved queries (STORY-228)', () => {
	it('survives the share-link encode/decode round trip', () => {
		const enc = encodeModelForUrl(alertsForServer());
		expect(enc.ok).toBe(true);
		if (!enc.ok) return;
		const dec = decodeModelFromUrl(enc.param);
		expect(dec).toEqual({ ok: true, model: alertsForServer() });
	});

	it('reopens a saved builder query that has inverse hops, still runnable', () => {
		const item = toSavedQueryItem(
			{
				iri: `${SOC_DATA_NS}saved-1`, label: 'Alerts for web-01', description: '', createdBy: 'a',
				queryModel: serializeQueryModel(alertsForServer()), sparqlText: ''
			} as never,
			null
		);
		const opened = openSavedQuery(item);
		expect(opened.kind).toBe('builder');
		if (opened.kind === 'builder') {
			expect(opened.model).toEqual(alertsForServer());
			expect(validateRunnableQueryModel(opened.model, new Set(schema.classes.keys()), schema)).toEqual([]);
			expect(parseQueryModel(serializeQueryModel(opened.model)).ok).toBe(true);
			expect(() => compileQuery(opened.model, schema, PAGE)).not.toThrow();
		}
	});
});
