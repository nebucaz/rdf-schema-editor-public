import { describe, expect, it } from 'vitest';
import { iriForSchemeId, resolveScheme, schemeIdForIri } from './scheme-id';

const CORE = 'http://example.org/core';

describe('scheme ids', () => {
	it('uses the local name for a scheme in the core namespace', () => {
		expect(schemeIdForIri(`${CORE}#Workforce`, CORE)).toBe('Workforce');
		expect(iriForSchemeId('Workforce', CORE)).toBe(`${CORE}#Workforce`);
	});
	it('falls back to ~ + base64url for any other IRI and round-trips', () => {
		const iri = 'http://other.example/schemes/a b'.replace(' ', '%20');
		const id = schemeIdForIri(iri, CORE);
		expect(id.startsWith('~')).toBe(true);
		expect(iriForSchemeId(id, CORE)).toBe(iri);
	});
	it('rejects ids that are not well formed', () => {
		expect(iriForSchemeId('', CORE)).toBeNull();
		expect(iriForSchemeId('a b', CORE)).toBeNull();
		expect(iriForSchemeId('~!!!', CORE)).toBeNull();
		expect(iriForSchemeId(`~${btoa('javascript:alert(1)')}`, CORE)).toBeNull();
	});
});

describe('resolveScheme', () => {
	const schemes = [{ iri: `${CORE}#Workforce` }, { iri: 'http://other.example/s' }];
	it('finds a scheme by either kind of id and only among the fetched ones', () => {
		expect(resolveScheme(schemes, 'Workforce', CORE)).toBe(schemes[0]);
		expect(resolveScheme(schemes, schemeIdForIri('http://other.example/s', CORE), CORE)).toBe(schemes[1]);
		expect(resolveScheme(schemes, 'Missing', CORE)).toBeNull();
		expect(resolveScheme(schemes, 'no good!', CORE)).toBeNull();
	});
});
