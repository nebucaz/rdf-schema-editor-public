import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec/loop-issues STORY-311: a SELECT over an unrestricted `GRAPH ?g { }` returns one row per
 * graph (and per label) when the same triple lives in several graphs, which broke keyed `{#each}` lists
 * (`each_key_duplicate`). Every such SELECT must say `DISTINCT` or `GROUP BY`, or be listed below with the reason.
 */

/** Method name -> why a plain cross-graph SELECT is acceptable there. */
const EXISTENCE = 'LIMIT 1 existence/graph lookup: only the first row is read';
const ALLOWED: Record<string, string> = {
	changeIndividualClass: EXISTENCE,
	findNamespaceOfClass: EXISTENCE,
	findNamespaceOfSubject: EXISTENCE,
	fetchOwnNamespaceCrossGraph: EXISTENCE,
	findNamespaceOfIndividual: EXISTENCE,
	findNamespaceOfPossiblyUntypedIndividual: EXISTENCE,
	findObjectPropertyByLabel: EXISTENCE,
	fetchInverseRelation: EXISTENCE,
	fetchDirectSuperclassesCrossGraph: 'consumed by a breadth-first walk with a visited set, repeats are harmless',
	fetchLabelsForIris: 'rows are folded into a Map keyed by IRI, repeats overwrite',
	fetchAnnotationsForFacts: 'rows are deduplicated by (fact, annotation IRI) in the loop below the query',
	fetchAllReifiedStatements: 'its only consumer, fetchNameableEntities, deduplicates by IRI (dedupeByIri)',
	// Not yet reviewed for a keyed consumer: follow-up of spec/loop-issues, fix each with GROUP BY like STORY-309/310.
	fetchAllIndividuals: 'TODO: one row per label/graph x type; consumers not yet audited for keyed lists',
	fetchAllIndividualClassRelations: 'TODO: OPTIONAL predicate label can repeat a relation; consumers not yet audited',
	fetchIdentityNeighborhood: 'TODO: first (individuals) query has no DISTINCT; consumers not yet audited',
	fetchSchemaBatched:
		'TODO: ?g is bound by VALUES so rows are per namespace graph by design; repeats only from multiple labels in one graph; consumers not yet audited'
};

/** Every top-level template literal in `source`, with the name of the method that encloses it. */
export function templateLiterals(source: string): Array<{ method: string; text: string; line: number }> {
	const found: Array<{ method: string; text: string; line: number }> = [];
	let method = '(top level)';
	let i = 0;
	let line = 1;
	while (i < source.length) {
		const ch = source[i];
		if (ch === '\n') {
			line++;
			i++;
			const m = /^\t(?:private |public |static |async )*([A-Za-z_]\w*)\s*(?:<[^>]*>)?\(/.exec(
				source.slice(i, i + 200)
			);
			if (m && !['if', 'for', 'while', 'switch', 'catch', 'return'].includes(m[1])) method = m[1];
			continue;
		}
		if (ch === '/' && source[i + 1] === '/') {
			while (i < source.length && source[i] !== '\n') i++;
			continue;
		}
		if (ch === '/' && source[i + 1] === '*') {
			const end = source.indexOf('*/', i + 2);
			const stop = end === -1 ? source.length : end + 2;
			line += source.slice(i, stop).split('\n').length - 1;
			i = stop;
			continue;
		}
		if (ch === "'" || ch === '"') {
			i++;
			while (i < source.length && source[i] !== ch && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1;
			i++;
			continue;
		}
		if (ch === '`') {
			const start = i++;
			const startLine = line;
			let depth = 0;
			while (i < source.length && (source[i] !== '`' || depth > 0)) {
				if (source[i] === '\n') line++;
				if (source[i] === '\\') i++;
				else if (source[i] === '$' && source[i + 1] === '{') {
					depth++;
					i++;
				} else if (source[i] === '}' && depth > 0) depth--;
				i++;
			}
			found.push({ method, text: source.slice(start, ++i), line: startLine });
			continue;
		}
		i++;
	}
	return found;
}

/** Cross-graph SELECTs lacking `DISTINCT`/`GROUP BY`, as `method (line n)`. */
export function findUngroupedCrossGraphSelects(source: string): Array<{ method: string; line: number }> {
	return templateLiterals(source)
		.filter(({ text }) => /\bSELECT\b/.test(text) && /\bGRAPH\s+\?/.test(text))
		.filter(({ text }) => !/\bDISTINCT\b/i.test(text) && !/\bGROUP\s+BY\b/i.test(text))
		.map(({ method, line }) => ({ method, line }));
}

describe('findUngroupedCrossGraphSelects', () => {
	it('flags a cross-graph SELECT without DISTINCT or GROUP BY', () => {
		const src = 'class A {\n\tasync f() {\n\t\tq(`SELECT ?i WHERE { GRAPH ?g { ?i a ?c } }`);\n\t}\n}';
		expect(findUngroupedCrossGraphSelects(src)).toEqual([{ method: 'f', line: 3 }]);
	});

	it('accepts DISTINCT, GROUP BY, single-graph SELECTs and non-SELECT updates', () => {
		const src = [
			'class A {',
			'\tasync f() {',
			'\t\tq(`SELECT DISTINCT ?i WHERE { GRAPH ?g { ?i a ?c } }`);',
			'\t\tq(`SELECT ?i WHERE { GRAPH ?g { ?i a ?c } } GROUP BY ?i`);',
			'\t\tq(`SELECT ?i WHERE { GRAPH <urn:g> { ?i a ?c } }`);',
			'\t\tq(`DELETE WHERE { GRAPH ?g { ?i a ?c } }`);',
			'\t}',
			'}'
		].join('\n');
		expect(findUngroupedCrossGraphSelects(src)).toEqual([]);
	});

	it('ignores queries inside comments and plain strings', () => {
		const src = '// `SELECT ?i { GRAPH ?g { } }`\n/* `SELECT ?i { GRAPH ?g { } }` */\nconst a = "SELECT GRAPH ?g";';
		expect(findUngroupedCrossGraphSelects(src)).toEqual([]);
	});
});

describe('sparql-connector.ts', () => {
	it('has no cross-graph SELECT without DISTINCT/GROUP BY, except the allow-listed ones', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/services/sparql-connector.ts'), 'utf8');
		const violations = findUngroupedCrossGraphSelects(source)
			.filter((v) => !(v.method in ALLOWED))
			.map((v) => `${v.method} (line ${v.line})`);
		expect(violations).toEqual([]);
	});

	it('gives every allow-list entry a reason and a still-existing query', () => {
		const source = readFileSync(join(process.cwd(), 'src/lib/services/sparql-connector.ts'), 'utf8');
		const flagged = new Set(findUngroupedCrossGraphSelects(source).map((v) => v.method));
		for (const [method, reason] of Object.entries(ALLOWED)) {
			expect(reason.trim(), method).not.toBe('');
			expect(flagged.has(method), `${method} no longer needs its allow-list entry`).toBe(true);
		}
	});
});
