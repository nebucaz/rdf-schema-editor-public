/**
 * SPARQL interpolation guards shared by `sparql-connector.ts` and `query-compiler.ts`.
 * There is no parameterised-query mechanism, so every IRI/literal placed into a query string must go
 * through these.
 */

/** Characters excluded from the SPARQL 1.1 IRIREF grammar production. */
const UNSAFE_SPARQL_IRI_CHARS = /[<>"{}|^`\\\x00-\x20]/;

export function isSafeSparqlIri(value: string): boolean {
	return !UNSAFE_SPARQL_IRI_CHARS.test(value);
}

/** Rejects (throws on) any value that is not a safe IRIREF body; see `isSafeSparqlIri`. */
export function assertSafeSparqlIri(value: string, fieldName: string = 'IRI'): void {
	if (!isSafeSparqlIri(value)) {
		throw new Error(`Invalid ${fieldName}: contains characters not allowed in a SPARQL IRI`);
	}
}

/** Escapes a value for use between double quotes in a SPARQL string literal (ECHAR). `\` first. */
export function escapeSparqlString(str: string): string {
	return str
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r');
}
