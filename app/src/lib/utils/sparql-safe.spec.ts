import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { assertSafeSparqlIri, escapeSparqlString, isSafeSparqlIri } from './sparql-safe';
import { defaultNamespaceBaseIriFrom, namespaceGraphs } from '../config';

// Shared with the Go suite (backend/internal/sparqlsafe): the fixtures are what keeps the two
// implementations in agreement.
const golden = JSON.parse(
	readFileSync(new URL('../../../../backend/testdata/golden/sparql-safe.json', import.meta.url), 'utf8')
) as {
	safeIri: { name: string; input: string; safe: boolean }[];
	escapeString: { name: string; input: string; output: string }[];
	namespaceGraphs: { name: string; baseIri: string; graphs: Record<string, string> }[];
	defaultNamespaceBaseIri: { name: string; raw: string; baseIri: string }[];
};

describe('golden vectors shared with the Go backend', () => {
	it.each(golden.safeIri)('isSafeSparqlIri: $name', ({ input, safe }) => {
		expect(isSafeSparqlIri(input)).toBe(safe);
		if (safe) expect(() => assertSafeSparqlIri(input)).not.toThrow();
		else expect(() => assertSafeSparqlIri(input)).toThrow();
	});

	it.each(golden.escapeString)('escapeSparqlString: $name', ({ input, output }) => {
		expect(escapeSparqlString(input)).toBe(output);
	});

	it.each(golden.namespaceGraphs)('namespaceGraphs: $name', ({ baseIri, graphs }) => {
		expect(namespaceGraphs(baseIri)).toEqual(graphs);
	});

	it.each(golden.defaultNamespaceBaseIri)('default namespace base: $name', ({ raw, baseIri }) => {
		expect(defaultNamespaceBaseIriFrom(raw)).toBe(baseIri);
	});
});
