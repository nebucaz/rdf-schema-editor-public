import { describe, it, expect } from 'vitest';
import {
	emptyQueryModel,
	parseQueryModel,
	serializeQueryModel,
	validateQueryModel,
	type Filter,
	type QueryModel
} from './query-model';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';
import { compileCountQuery, compileQuery, QueryCompileError } from './query-compiler';
import { printSplPipeline } from './query-spl';
import { lexicalFormError } from './query-datatypes';

const NS = 'http://example.org/ns';
const iri = (n: string) => `${NS}#${n}`;
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const fetched: FetchedSchema = {
	classes: [{ iri: iri('Event'), label: 'Event', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [
		{ iri: iri('timestamp'), label: 'timestamp', domain: iri('Event'), range: `${XSD}dateTime`, namespaceBaseIri: NS, required: false, repeatable: false },
		{ iri: iri('day'), label: 'day', domain: iri('Event'), range: `${XSD}date`, namespaceBaseIri: NS, required: false, repeatable: false },
		{ iri: iri('bytes'), label: 'bytes', domain: iri('Event'), range: `${XSD}integer`, namespaceBaseIri: NS, required: false, repeatable: false },
		{ iri: iri('ratio'), label: 'ratio', domain: iri('Event'), range: `${XSD}decimal`, namespaceBaseIri: NS, required: false, repeatable: false },
		{ iri: iri('user'), label: 'user', domain: iri('Event'), range: `${XSD}string`, namespaceBaseIri: NS, required: false, repeatable: false }
	],
	objectProperties: [],
	subClassOf: [],
	individuals: [],
	individualClassRelations: [],
	individualIndividualRelations: []
};
const schema = buildBuilderSchema(fetched);
const known = new Set(schema.classes.keys());

function model(...filters: Partial<Filter>[]): QueryModel {
	const m = emptyQueryModel(iri('Event'), [NS]);
	m.columns = [{ id: 'c', hopId: null, source: 'label', header: 'Name' }];
	m.filters = filters.map((f, i) => ({
		id: `f${i}`, hopId: null, propertyIri: iri('timestamp'), op: 'gte', value: '2025-03-14T14:00:00Z', ...f
	}));
	return m;
}
const issuesOf = (m: QueryModel) => validateQueryModel(m, known, schema).map((i) => `${i.path}: ${i.message}`);

describe('comparison filter ops — model and validation', () => {
	it('parseQueryModel accepts gt, gte, lt and lte', () => {
		for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
			const parsed = parseQueryModel(serializeQueryModel(model({ op })));
			expect(parsed.ok, op).toBe(true);
		}
	});

	it('still rejects unknown ops', () => {
		const m = JSON.parse(serializeQueryModel(model({})));
		m.filters[0].op = 'between';
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
	});

	it('accepts valid dateTime, date, integer and decimal comparisons', () => {
		expect(issuesOf(model(
			{ op: 'gt', value: '2025-03-14T14:00:00Z' },
			{ op: 'lte', propertyIri: iri('day'), value: '2025-03-14' },
			{ op: 'lt', propertyIri: iri('bytes'), value: '100' },
			{ op: 'gte', propertyIri: iri('ratio'), value: '0.5' }
		))).toEqual([]);
	});

	it('rejects ordering ops on a string property', () => {
		expect(issuesOf(model({ op: 'gt', propertyIri: iri('user'), value: 'a' }))).toEqual([
			expect.stringContaining('filters[0]')
		]);
	});

	it('rejects ordering ops on the entity itself (no property)', () => {
		expect(issuesOf(model({ op: 'lt', propertyIri: null, value: '5' })).length).toBe(1);
	});

	it('rejects an unknown property when a schema is supplied', () => {
		expect(issuesOf(model({ op: 'lt', propertyIri: iri('nope'), value: '5' })).length).toBe(1);
	});

	it('rejects a missing or list value', () => {
		expect(issuesOf(model({ op: 'gt', value: undefined })).length).toBe(1);
		expect(issuesOf(model({ op: 'gt', value: ['2025-03-14T14:00:00Z'] })).length).toBe(1);
	});

	it('rejects malformed lexical values', () => {
		const bad: [string, string][] = [
			['bytes', '1; DROP'],
			['bytes', '1.5'],
			['bytes', ''],
			['ratio', 'abc'],
			['timestamp', '2025-13-45'],
			['timestamp', '2025-03-14'],
			['timestamp', '2025-02-30T10:00:00Z'],
			['timestamp', '2025-03-14T25:00:00Z'],
			['timestamp', '2025-03-14T14:00:00Z"^^<x>) } #'],
			['day', '2025-03-14T14:00:00Z'],
			['day', '2025-00-10']
		];
		for (const [p, value] of bad) {
			expect(issuesOf(model({ op: 'gte', propertyIri: iri(p), value })).length, `${p} ${value}`).toBe(1);
		}
	});

	it('structural validation without a schema does not check datatypes', () => {
		expect(validateQueryModel(model({ op: 'gt', propertyIri: iri('user'), value: 'a' }), known)).toEqual([]);
	});
});

describe('lexicalFormError', () => {
	it('knows each supported datatype', () => {
		expect(lexicalFormError(`${XSD}integer`, '-42')).toBeNull();
		expect(lexicalFormError(`${XSD}double`, '1.5e10')).toBeNull();
		expect(lexicalFormError(`${XSD}float`, 'NaN')).toBeNull();
		expect(lexicalFormError(`${XSD}dateTime`, '2025-03-14T14:00:00.250+01:00')).toBeNull();
		expect(lexicalFormError(`${XSD}date`, '2024-02-29')).toBeNull();
		expect(lexicalFormError(`${XSD}date`, '2025-02-29')).not.toBeNull();
		expect(lexicalFormError(`${XSD}string`, 'x')).not.toBeNull();
	});
});

describe('comparison filter ops — compiler', () => {
	const sparql = (m: QueryModel) => compileQuery(m, schema, { limit: 10, offset: 0 }).sparql;

	it('emits typed-literal comparisons from the schema datatype, not STR()', () => {
		const q = sparql(model({ op: 'gte', value: '2025-03-14T14:00:00Z' }));
		expect(q).toContain(`?root <${iri('timestamp')}> ?f0 .`);
		expect(q).toContain(`FILTER(?f0 >= "2025-03-14T14:00:00Z"^^<${XSD}dateTime>)`);
		expect(q).not.toContain('STR(?f0)');
	});

	it('emits each operator and a range as two filters', () => {
		const q = sparql(model(
			{ op: 'gte', value: '2025-03-14T14:00:00Z' },
			{ op: 'lt', value: '2025-03-15T00:00:00Z' },
			{ op: 'gt', propertyIri: iri('bytes'), value: '100' },
			{ op: 'lte', propertyIri: iri('ratio'), value: '0.5' }
		));
		expect(q).toContain(`FILTER(?f0 >= "2025-03-14T14:00:00Z"^^<${XSD}dateTime>)`);
		expect(q).toContain(`FILTER(?f1 < "2025-03-15T00:00:00Z"^^<${XSD}dateTime>)`);
		expect(q).toContain(`FILTER(?f2 > "100"^^<${XSD}integer>)`);
		expect(q).toContain(`FILTER(?f3 <= "0.5"^^<${XSD}decimal>)`);
	});

	it('takes the datatype from the schema even if the model carries a different-looking value', () => {
		const q = sparql(model({ op: 'gt', propertyIri: iri('day'), value: '2025-03-14' }));
		expect(q).toContain(`"2025-03-14"^^<${XSD}date>`);
	});

	it('never lets an invalid lexical form reach SPARQL', () => {
		for (const value of ['1; DROP', '2025-13-45', '1"^^<x>) } #']) {
			for (const p of ['bytes', 'timestamp']) {
				const m = model({ op: 'gt', propertyIri: iri(p), value });
				expect(() => compileQuery(m, schema, { limit: 10, offset: 0 }), `${p} ${value}`).toThrow(QueryCompileError);
				expect(() => compileCountQuery(m, schema)).toThrow(QueryCompileError);
			}
		}
	});

	it('leaves queries without comparison ops byte-identical', () => {
		const m = model({ op: 'eq', propertyIri: iri('user'), value: 'bob' });
		expect(sparql(m)).toContain(`FILTER(STR(?f0) = "bob")`);
		expect(sparql(m)).not.toContain('^^');
	});
});

describe('comparison filter ops — SPL printer and serialisation', () => {
	it('prints the four operators', () => {
		const print = (op: Filter['op'], propertyIri = iri('timestamp'), value = '2025-03-14T14:00:00Z') =>
			printSplPipeline(model({ op, propertyIri, value }), schema).split('\n')[1];
		expect(print('gte')).toBe('| where timestamp>="2025-03-14T14:00:00Z"');
		expect(print('gt')).toBe('| where timestamp>"2025-03-14T14:00:00Z"');
		expect(print('lt')).toBe('| where timestamp<"2025-03-14T14:00:00Z"');
		// Numbers print bare (their lexical form is validated); dates and times stay quoted.
		expect(print('lte', iri('bytes'), '100')).toBe('| where bytes<=100');
		expect(print('gt', iri('day'), '2025-03-14')).toBe('| where day>"2025-03-14"');
	});

	it('keeps version 1 and serialises a model without comparison ops unchanged', () => {
		const m = model({ op: 'eq', propertyIri: iri('user'), value: 'bob' });
		expect(m.version).toBe(1);
		expect(JSON.parse(serializeQueryModel(m))).toEqual(m);
		expect(Object.keys(m).sort()).toEqual(
			['columns', 'filters', 'hops', 'namespaces', 'root', 'sort', 'version']
		);
	});
});
