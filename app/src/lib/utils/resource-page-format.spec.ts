import { describe, expect, it } from 'vitest';
import {
	deriveResourceHeader,
	displayLabel,
	formatLiteralValue,
	labelOrPrettify,
	prettifyLocalName,
	splitOutgoingTriples
} from './resource-page-format';
import type { ResourcePageTriple } from '$lib/services/sparql-connector';

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';

describe('prettifyLocalName', () => {
	it('splits camelCase and separators into space-separated words, capitalizing only the first', () => {
		expect(prettifyLocalName('http://ex.org#employmentStartDate')).toBe('Employment Start Date');
		expect(prettifyLocalName('http://ex.org#employment-start-date')).toBe('Employment start date');
		expect(prettifyLocalName('http://ex.org#employment_start_date')).toBe('Employment start date');
	});

	it('falls back to the bare local name when there is nothing to split', () => {
		expect(prettifyLocalName('http://ex.org#Person')).toBe('Person');
	});
});

describe('labelOrPrettify', () => {
	it('prefers a provided non-blank label', () => {
		expect(labelOrPrettify('Alice', 'http://ex.org#alice')).toBe('Alice');
	});

	it('falls back to a prettified local name for undefined/null/blank labels', () => {
		expect(labelOrPrettify(undefined, 'http://ex.org#alice')).toBe('Alice');
		expect(labelOrPrettify(null, 'http://ex.org#alice')).toBe('Alice');
		expect(labelOrPrettify('   ', 'http://ex.org#alice')).toBe('Alice');
	});
});

describe('displayLabel', () => {
	it('leaves an already human-formatted label unchanged', () => {
		expect(displayLabel('John Smith')).toBe('John Smith');
		expect(displayLabel('Full Name')).toBe('Full Name');
	});

	it('prettifies a raw local-name fallback (e.g. from extractLocalName)', () => {
		expect(displayLabel('employmentStartDate')).toBe('Employment Start Date');
	});
});

describe('formatLiteralValue', () => {
	it('passes untyped/non-date values through unchanged', () => {
		expect(formatLiteralValue('hello')).toBe('hello');
		expect(formatLiteralValue('42', 'http://www.w3.org/2001/XMLSchema#integer')).toBe('42');
	});

	it('formats a valid xsd:date/xsd:dateTime value as a locale string', () => {
		const formatted = formatLiteralValue('2024-01-15', 'http://www.w3.org/2001/XMLSchema#date');
		expect(formatted).toBe(new Date(Date.parse('2024-01-15')).toLocaleString());
	});

	it('leaves an unparsable date-typed value as-is', () => {
		expect(formatLiteralValue('not-a-date', 'http://www.w3.org/2001/XMLSchema#date')).toBe('not-a-date');
	});
});

function triple(overrides: Partial<ResourcePageTriple>): ResourcePageTriple {
	return {
		predicateIri: 'http://ex.org#prop',
		predicateLabel: 'prop',
		object: 'value',
		objectType: 'literal',
		...overrides
	};
}

describe('deriveResourceHeader', () => {
	it('pulls the label and every rdf:type from the outgoing triples', () => {
		const outgoing = [
			triple({ predicateIri: RDFS_LABEL, object: 'Alice', objectType: 'literal' }),
			triple({ predicateIri: RDF_TYPE, object: 'http://ex.org#Person', objectType: 'uri' }),
			triple({ predicateIri: RDF_TYPE, object: 'http://ex.org#Employee', objectType: 'uri' }),
			triple({ predicateIri: 'http://ex.org#age', object: '30', objectType: 'literal' })
		];
		expect(deriveResourceHeader('http://ex.org#alice', outgoing)).toEqual({
			label: 'Alice',
			typeIris: ['http://ex.org#Person', 'http://ex.org#Employee']
		});
	});

	it('falls back to a prettified IRI and an empty type list when neither is present', () => {
		expect(deriveResourceHeader('http://ex.org#alice', [])).toEqual({ label: 'Alice', typeIris: [] });
	});
});

describe('splitOutgoingTriples', () => {
	it('splits into literal vs URI, excluding rdf:type and rdfs:label', () => {
		const outgoing = [
			triple({ predicateIri: RDFS_LABEL, object: 'Alice', objectType: 'literal' }),
			triple({ predicateIri: RDF_TYPE, object: 'http://ex.org#Person', objectType: 'uri' }),
			triple({ predicateIri: 'http://ex.org#age', object: '30', objectType: 'literal' }),
			triple({ predicateIri: 'http://ex.org#worksAt', object: 'http://ex.org#acme', objectType: 'uri' })
		];
		expect(splitOutgoingTriples(outgoing)).toEqual({
			literalTriples: [triple({ predicateIri: 'http://ex.org#age', object: '30', objectType: 'literal' })],
			uriTriples: [
				triple({ predicateIri: 'http://ex.org#worksAt', object: 'http://ex.org#acme', objectType: 'uri' })
			]
		});
	});

	it('returns two empty arrays for an empty input', () => {
		expect(splitOutgoingTriples([])).toEqual({ literalTriples: [], uriTriples: [] });
	});
});
