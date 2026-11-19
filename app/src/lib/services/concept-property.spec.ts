import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI } from '#lib/utils/iri.js';
import { SCHEMA_NAMESPACE } from '#lib/config.js';
import { buildSchemeConstraintMessage, buildSchemeConstraintSelect } from './concept-property';

// Shared with the Go contract test (backend/internal/validation, STORY-434): ties the generated text to ValidateSelect.
const golden = JSON.parse(
	readFileSync(new URL('../../../../backend/testdata/golden/concept-property.json', import.meta.url), 'utf8')
) as {
	vectors: { name: string; propertyIri: string; schemeIri: string; select: string }[];
	unsafe: { name: string; propertyIri: string; schemeIri: string }[];
};

describe('rse:valueScheme marker', () => {
	it('lives in the schema namespace', () => {
		expect(CONCEPT_PROPERTY_SCHEME_PREDICATE_IRI).toBe(`${SCHEMA_NAMESPACE}valueScheme`);
	});
});

describe('buildSchemeConstraintSelect', () => {
	it.each(golden.vectors)('matches the golden text: $name', ({ propertyIri, schemeIri, select }) => {
		expect(buildSchemeConstraintSelect(propertyIri, schemeIri)).toBe(select);
	});

	it.each(golden.unsafe)('throws on an unsafe IRI: $name', ({ propertyIri, schemeIri }) => {
		expect(() => buildSchemeConstraintSelect(propertyIri, schemeIri)).toThrow();
	});

	it('is deterministic', () => {
		const [v] = golden.vectors;
		expect(buildSchemeConstraintSelect(v.propertyIri, v.schemeIri)).toBe(buildSchemeConstraintSelect(v.propertyIri, v.schemeIri));
	});

	it.each(golden.vectors)('is one plain SELECT of $this, ?value and ?path: $name', ({ propertyIri, schemeIri }) => {
		const text = buildSchemeConstraintSelect(propertyIri, schemeIri);
		expect(text.match(/\bSELECT\b/g)).toHaveLength(1);
		expect(text.startsWith('SELECT $this ?value (<')).toBe(true);
		expect(text).toContain(' AS ?path)');
		expect(text).not.toMatch(/\b(SERVICE|INSERT|DELETE|LOAD|CLEAR|DROP|PREFIX)\b|\\u/i);
	});
});

describe('buildSchemeConstraintMessage', () => {
	it('names the property and the scheme', () => {
		const message = buildSchemeConstraintMessage('lifecycleStage', 'Lifecycle');
		expect(message).toContain('lifecycleStage');
		expect(message).toContain('Lifecycle');
	});
});
