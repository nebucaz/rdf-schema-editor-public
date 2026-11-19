import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildImportPlan, parseSkosTurtle } from './skos-import';
import { commonImportBase, retargetImport, retargetProblem } from './skos-import-retarget';

const FILE = readFileSync(new URL('../../../../examples/asset-classification/asset-classification.ttl', import.meta.url), 'utf8');
const FROM = 'http://example.org/asset-classification#';
const TO = 'https://lida.pnet.ch/core#';
const empty = { schemes: [], concepts: [], collections: [] };

describe('commonImportBase', () => {
	it('finds the shared start of the example, up to and including the #', () => {
		expect(commonImportBase(parseSkosTurtle(FILE))).toBe(FROM);
	});

	it('is empty for no concepts or for IRIs that share no path', () => {
		expect(commonImportBase({ concepts: [], schemes: [] })).toBe('');
		const parsed = parseSkosTurtle(`@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
<http://a.example/x> a skos:Concept ; skos:prefLabel "X"@en . <urn:y> a skos:Concept ; skos:prefLabel "Y"@en .`);
		expect(commonImportBase(parsed)).toBe('');
	});
});

describe('retargetImport', () => {
	const parsed = parseSkosTurtle(FILE);

	it('rewrites every IRI that starts with the old base, links included, and nothing else', () => {
		const out = retargetImport(parsed, { fromBase: FROM, toBase: TO });
		const iris = [
			...out.schemes.map((s) => s.iri),
			...out.concepts.flatMap((c) => [c.iri, c.schemeIri, ...c.broader, ...c.related, ...c.mappings.map((m) => m.target)])
		].filter(Boolean);
		expect(iris.every((i) => i.startsWith(TO))).toBe(true);
		expect(out.concepts).toHaveLength(parsed.concepts.length);
		expect(out.concepts.find((c) => c.iri === `${TO}Live`)?.mappings).toEqual([{ kind: 'exactMatch', target: `${TO}Production` }]);
		expect(parsed.concepts.some((c) => c.iri.startsWith(FROM))).toBe(true); // the input is not changed
	});

	it('leaves external mapping targets alone', () => {
		const p = parseSkosTurtle(`@prefix skos: <http://www.w3.org/2004/02/skos/core#> . @prefix ex: <${FROM}> .
ex:A a skos:Concept ; skos:prefLabel "A"@en ; skos:exactMatch <http://other.example/A> .`);
		const out = retargetImport(p, { fromBase: FROM, toBase: TO });
		expect(out.concepts[0].mappings[0].target).toBe('http://other.example/A');
	});

	it('moves every concept into an existing scheme and drops the file schemes', () => {
		const out = retargetImport(parsed, { fromBase: FROM, toBase: TO, scheme: { kind: 'existing', iri: `${TO}Mine` } });
		expect(out.schemes).toEqual([]);
		expect(new Set(out.concepts.map((c) => c.schemeIri))).toEqual(new Set([`${TO}Mine`]));
		expect(out.info.some((i) => i.code === 'scheme-replaced')).toBe(true);
		expect(out.concepts.filter((c) => c.topConcept).length).toBe(parsed.concepts.filter((c) => c.topConcept).length);
	});

	it('creates a new scheme for the chosen name', () => {
		const out = retargetImport(parsed, { scheme: { kind: 'new', iri: `${TO}Assets`, name: ' Assets ' } });
		expect(out.schemes).toMatchObject([{ iri: `${TO}Assets`, name: 'Assets' }]);
		const plan = buildImportPlan(out, empty);
		expect(plan.entries.filter((e) => e.kind === 'scheme')).toHaveLength(1);
		expect(plan.entries.filter((e) => e.kind === 'concept')).toHaveLength(parsed.concepts.length);
	});

	it('changes nothing without options', () => {
		const out = retargetImport(parsed, {});
		expect(out.concepts.map((c) => c.iri)).toEqual(parsed.concepts.map((c) => c.iri));
		expect(out.schemes).toEqual(parsed.schemes);
	});

	it('refuses half-filled or unsafe options', () => {
		expect(retargetProblem({ fromBase: FROM })).toMatch(/new IRI start/);
		expect(retargetProblem({ toBase: TO })).toMatch(/IRI start to replace/);
		expect(retargetProblem({ fromBase: FROM, toBase: 'a b>' })).toMatch(/not a valid IRI/);
		expect(retargetProblem({ scheme: { kind: 'new', iri: `${TO}X`, name: ' ' } })).toMatch(/name/);
		expect(() => retargetImport(parsed, { fromBase: FROM })).toThrow();
	});
});
