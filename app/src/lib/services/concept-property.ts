/**
 * Concept-valued properties (spec/concept-valued-properties): the constraint generated for a property whose
 * values must be concepts of one scheme. Pure; the Go engine only validates and runs the text (`ValidateSelect`),
 * and `backend/testdata/golden/concept-property.json` ties the two sides together.
 */
import { assertSafeSparqlIri } from '#lib/utils/sparql-safe.js';

const SKOS = 'http://www.w3.org/2004/02/skos/core#';

/** The `sh:select` of the `sh:sparql` constraint: every value that is not a concept of the scheme is a violation. */
export function buildSchemeConstraintSelect(propertyIri: string, schemeIri: string): string {
	assertSafeSparqlIri(propertyIri, 'property IRI');
	assertSafeSparqlIri(schemeIri, 'scheme IRI');
	return (
		`SELECT $this ?value (<${propertyIri}> AS ?path)\n` +
		`WHERE {\n` +
		`  $this <${propertyIri}> ?value .\n` +
		`  FILTER NOT EXISTS { ?value a <${SKOS}Concept> ; <${SKOS}inScheme> <${schemeIri}> }\n` +
		`}`
	);
}

/** The `sh:message` of the generated constraint. */
export function buildSchemeConstraintMessage(propertyName: string, schemeName: string): string {
	return `${propertyName} must be a concept of the scheme ${schemeName}`;
}
