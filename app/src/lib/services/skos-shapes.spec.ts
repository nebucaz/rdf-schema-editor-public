import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Parser } from 'n3';
import { SKOS_SHAPES_TURTLE, skosShapesTurtle } from './skos-shapes';
import { SKOS_NS, SKOS } from '#lib/utils/iri.js';
import { SCHEMA_NAMESPACE } from '#lib/config.js';

const SH = 'http://www.w3.org/ns/shacl#';
const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const quads = new Parser().parse(SKOS_SHAPES_TURTLE);

/** The property-shape keys the Go engine evaluates: the `ignoredPropertyKeys` list in `snapshot.go`. */
function engineKeys(): Set<string> {
	const source = readFileSync(fileURLToPath(new URL('../../../../backend/internal/validation/snapshot.go', import.meta.url)), 'utf8');
	const block = source.slice(source.indexOf('var ignoredPropertyKeys'), source.indexOf('}\n', source.indexOf('var ignoredPropertyKeys')));
	const names = [...block.matchAll(/\bsh([A-Z]\w*)\b/g)].map((m) => `${SH}${m[1][0].toLowerCase()}${m[1].slice(1)}`);
	const quoted = [...block.matchAll(/shNS \+ "(\w+)"/g)].map((m) => `${SH}${m[1]}`);
	return new Set([...names, ...quoted]);
}

describe('SKOS SHACL shapes (STORY-413)', () => {
	it('parses with n3 and is a constant, so two calls agree', () => {
		expect(quads.length).toBeGreaterThan(10);
		expect(skosShapesTurtle()).toBe(SKOS_SHAPES_TURTLE);
	});

	it('targets skos:Concept and skos:Collection with node shapes', () => {
		const targets = quads.filter((q) => q.predicate.value === `${SH}targetClass`).map((q) => q.object.value).sort();
		expect(targets).toEqual([SKOS.Collection, SKOS.Concept].sort());
		expect(quads.filter((q) => q.predicate.value === `${RDF}type` && q.object.value === `${SH}NodeShape`)).toHaveLength(2);
	});

	it('requires a prefLabel (one per language), a definition and a scheme for a concept', () => {
		const paths = quads.filter((q) => q.predicate.value === `${SH}path`).map((q) => q.object.value);
		for (const p of [SKOS.prefLabel, SKOS.definition, SKOS.inScheme, SKOS.member]) expect(paths).toContain(p);
		expect(quads.filter((q) => q.predicate.value === `${SH}uniqueLang`).length).toBe(2);
		expect(quads.filter((q) => q.predicate.value === `${SH}minCount`).length).toBe(4);
	});

	it('uses only SKOS terms from iri.ts, the project namespace and sh:, and nothing the engine would not check', () => {
		const allowedKeys = engineKeys();
		expect(allowedKeys.has(`${SH}uniqueLang`)).toBe(true);
		const structural = new Set([`${SH}property`, `${SH}targetClass`, `${RDF}type`, `${RDF}first`, `${RDF}rest`, `${SH}NodeShape`]);
		for (const q of quads) {
			const p = q.predicate.value;
			if (structural.has(p)) continue;
			expect(allowedKeys.has(p), `engine does not evaluate ${p}`).toBe(true);
		}
		for (const q of quads) {
			for (const term of [q.subject, q.object]) {
				if (term.termType !== 'NamedNode') continue;
				const v = term.value;
				const ok = v.startsWith(SKOS_NS) || v.startsWith(SH) || v.startsWith(SCHEMA_NAMESPACE) || v.startsWith(RDF);
				expect(ok, `unexpected IRI ${v}`).toBe(true);
			}
		}
	});

	it('lets a collection hold concepts or collections through sh:or of sh:class', () => {
		const classes = quads.filter((q) => q.predicate.value === `${SH}class`).map((q) => q.object.value).sort();
		expect(classes).toEqual([SKOS.Collection, SKOS.Concept].sort());
	});
});
