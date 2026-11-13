import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DataFactory } from 'n3';
import { parseTurtle, partitionQuads, RDF, SH, SH_NS, OWL, type Quad } from './turtle';
import { checkShaclWellFormedness, checkStructural } from './validation';

/**
 * ITAM example checks (`spec/shacl-test`): the `examples/itam-shapes/*.ttl` files parse and pass the
 * validators Import Turtle runs. GraphDB-free — only the Turtle text is read.
 */

const dir = fileURLToPath(new URL('../../../../examples/itam-shapes/', import.meta.url));
const load = (name: string) => readFileSync(dir + name, 'utf8');

const SCHEMA_NS = 'https://lida.pnet.ch/arm/schema#';
const SHAPE_FILES = readdirSync(dir).filter((f) => /^AC-.*\.ttl$/.test(f)).sort();

const schema = parseTurtle(load('itam-schema.ttl'));
const shapes = SHAPE_FILES.flatMap((f) => parseTurtle(load(f)));

const termsOfType = (quads: Quad[], type: string) =>
	new Set(quads.filter((q) => q.predicate.value === RDF.type && q.object.value === type).map((q) => q.subject.value));
const local = (iri: string) => iri.slice(SCHEMA_NS.length);

describe('itam-schema.ttl (STORY-349)', () => {
	it('declares the two classes and four datatype properties, in <base>/schema#', () => {
		expect([...termsOfType(schema, OWL.Class)].map(local).sort()).toEqual([
			'Applikationskomponente',
			'Infrastrukturkomponente'
		]);
		expect([...termsOfType(schema, OWL.DatatypeProperty)].map(local).sort()).toEqual([
			'A_APP_CMP_TYPE',
			'A_OBJECT_STATE',
			'A_TECHNICAL_ID',
			'NAME'
		]);
		expect(schema.every((q) => q.subject.value.startsWith(SCHEMA_NS))).toBe(true);
	});

	it('passes the structural check and stays in the schema partition', () => {
		expect(checkStructural(schema)).toEqual([]);
		const p = partitionQuads(schema);
		expect(p.shapes).toEqual([]);
		expect(p.instances).toEqual([]);
	});
});

describe('the six ITAM shape files (STORY-349)', () => {
	const nodeShapes = [...termsOfType(shapes, SH.NodeShape)];
	const sparqlBlocks = shapes.filter((q) => q.predicate.value === `${SH_NS}sparql`);

	it('are the six committed files, with 6 NodeShapes and 5 sh:sparql blocks', () => {
		expect(SHAPE_FILES).toHaveLength(6);
		expect(nodeShapes).toHaveLength(6);
		expect(sparqlBlocks).toHaveLength(5);
	});

	it('route every shape and its sh:sparql blank nodes to the shapes partition', () => {
		const p = partitionQuads(shapes);
		expect(p.schema).toEqual([]);
		expect(p.instances).toEqual([]);
		for (const b of sparqlBlocks) {
			expect(p.shapes.some((q) => q.subject.value === b.object.value && q.predicate.value === `${SH_NS}select`)).toBe(true);
		}
	});

	it('pass SHACL well-formedness and the structural check after the schema', () => {
		const merged = [...schema, ...shapes];
		const declared = termsOfType(merged, OWL.Class);
		expect(checkShaclWellFormedness(merged, declared)).toEqual([]);
		expect(checkStructural(merged)).toEqual([]);
	});
});

// -- STORY-350: data and the expected findings --------------------------------------------------

const DATA_NS = 'https://lida.pnet.ch/arm#';
const ENUM = 'https://lida.pnet.ch/enum/';
const P = (n: string) => SCHEMA_NS + n;
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

interface ExpectedFinding {
	individual: string;
	ruleId: string;
	constraint: string;
	path: string;
	engine: 'inMemory' | 'sparql';
}
const dataText = load('itam-data.ttl');
const data = parseTurtle(dataText);
const expected: { findings: ExpectedFinding[] } = JSON.parse(load('itam-expected.json'));
const findingKey = (f: Pick<ExpectedFinding, 'individual' | 'ruleId' | 'constraint' | 'path'>) =>
	[f.individual, f.ruleId, f.constraint, f.path].join(' | ');

/** Plain-code oracle: re-derives each rule's outcome from the parsed data, independent of the engine. */
function oracle(quads: Quad[]): string[] {
	const components = [...termsOfType(quads, P('Applikationskomponente'))].sort();
	const values = (s: string, p: string) => quads.filter((q) => q.subject.value === s && q.predicate.value === P(p)).map((q) => q.object);
	const out: string[] = [];
	const add = (individual: string, ruleId: string, constraint: string, p: string) =>
		out.push(findingKey({ individual, ruleId, constraint, path: P(p) }));
	const lexical = (t: { value: string }) => t.value;
	const sharedWithOther = (s: string, p: string) =>
		values(s, p).some((v) => components.some((o) => o !== s && values(o, p).some((w) => w.termType === v.termType && w.value === v.value)));

	for (const s of components) {
		const ids = values(s, 'A_TECHNICAL_ID');
		if (ids.length < 1) add(s, 'AC-TECHID-EXIST', 'minCount', 'A_TECHNICAL_ID');
		if (ids.some((v) => v.termType === 'Literal' && (v as { datatype: { value: string } }).datatype.value !== XSD_STRING)) {
			add(s, 'AC-TECHID-EXIST', 'datatype', 'A_TECHNICAL_ID');
		}
		if (ids.some((v) => lexical(v).length < 1)) add(s, 'AC-TECHID-EXIST', 'minLength', 'A_TECHNICAL_ID');
		if (ids.some((v) => v.termType === 'Literal' && lexical(v).replace(/^\s+|\s+$/g, '').length === 0)) {
			add(s, 'AC-TECHID-EXIST', 'sparql', 'A_TECHNICAL_ID');
		}
		if (ids.some((v) => !/^[0-9]+$/.test(lexical(v)))) add(s, 'AC-TECHID-FORMAT', 'pattern', 'A_TECHNICAL_ID');
		if (sharedWithOther(s, 'A_TECHNICAL_ID')) add(s, 'AC-TECHID-UNIQUE', 'sparql', 'A_TECHNICAL_ID');
		if (sharedWithOther(s, 'NAME')) add(s, 'AC-NAME-UNIQUE', 'sparql', 'NAME');

		const types = values(s, 'A_APP_CMP_TYPE').map(lexical);
		if (types.includes(ENUM + 'Applikationsmodul')) {
			const bad = values(s, 'NAME').some(
				(v) => v.termType !== 'Literal' || !/^[A-Z][A-Za-z0-9]{2,15}\.[A-Za-z0-9 &-]{3,39}$/.test(lexical(v))
			);
			if (bad) add(s, 'AC-NAME-FORMAT-MODUL', 'sparql', 'NAME');
		}
		if (values(s, 'A_OBJECT_STATE').map(lexical).includes(ENUM + 'Freigegeben')) {
			if (!types.some((t) => t === ENUM + 'Applikation' || t === ENUM + 'Applikationsmodul')) {
				add(s, 'AC-SPEC-ACCEPTED', 'sparql', 'A_APP_CMP_TYPE');
			}
		}
	}
	return out.sort();
}

describe('itam-data.ttl and itam-expected.json (STORY-350)', () => {
	const components = termsOfType(data, P('Applikationskomponente'));

	it('has 23 records: 22 application components and one infrastructure component', () => {
		const subjects = new Set(data.map((q) => q.subject.value));
		expect(subjects.size).toBe(23);
		expect(components.size).toBe(22);
		expect(termsOfType(data, P('Infrastrukturkomponente')).size).toBe(1);
		expect([...subjects].every((s) => s.startsWith(DATA_NS))).toBe(true);
	});

	it('passes the import validators together with the schema and shapes', () => {
		const merged = [...schema, ...shapes, ...data];
		expect(checkStructural(merged)).toEqual([]);
		expect(checkShaclWellFormedness(merged, termsOfType(merged, OWL.Class))).toEqual([]);
		const p = partitionQuads(data);
		expect(p.shapes).toEqual([]);
		expect(p.schema.length).toBe(data.length);
	});

	it('lists exactly 22 expected findings, each for an existing individual and a real rule id and path', () => {
		expect(expected.findings).toHaveLength(22);
		const ruleIds = new Set(
			shapes.filter((q) => q.predicate.value === P('id')).map((q) => q.object.value)
		);
		const properties = termsOfType(schema, OWL.DatatypeProperty);
		for (const f of expected.findings) {
			expect(components.has(f.individual), f.individual).toBe(true);
			expect(ruleIds.has(f.ruleId), f.ruleId).toBe(true);
			expect(properties.has(f.path), f.path).toBe(true);
			expect(['inMemory', 'sparql']).toContain(f.engine);
		}
		expect(new Set(expected.findings.map(findingKey)).size).toBe(22);
	});

	it('has the plain-code oracle agree with the expected table exactly', () => {
		expect(oracle(data)).toEqual(expected.findings.map(findingKey).sort());
	});

	it('detects a stray defect: the oracle notices a duplicated name', () => {
		const r01 = DATA_NS + 'R01';
		const stray = data.filter((q) => !(q.subject.value === r01 && q.predicate.value === P('NAME')));
		stray.push(DataFactory.quad(DataFactory.namedNode(r01), DataFactory.namedNode(P('NAME')), DataFactory.literal('Doppelt')));
		expect(oracle(stray)).not.toEqual(expected.findings.map(findingKey).sort());
	});

	it('mentions every expected finding in the data file header', () => {
		const header = dataText.split('\n').filter((l) => l.startsWith('#')).join('\n');
		for (const f of expected.findings) {
			const record = f.individual.slice(DATA_NS.length);
			const line = header.split('\n').find((l) => l.includes(record) && l.includes(f.ruleId.replace(/^AC-/, '')));
			expect(line, `${record} ${f.ruleId}`).toBeTruthy();
		}
	});
});
