import { describe, expect, it } from 'vitest';
import { buildSchemeRows, filterSchemeRows } from './scheme-rows';
import type { Concept, ConceptScheme } from './skos-concept';

const scope = { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' };
const scheme = (iri: string, name: string, modified = ''): ConceptScheme => ({
	iri, name, description: '', scope,
	metadata: { title: '', creator: '', publisher: '', rights: '', modified }
});
const concept = (iri: string, schemeIri: string, over: Partial<Concept> = {}): Concept => ({
	iri, prefLabels: [{ text: iri, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [], scopeNotes: [], disambiguation: '',
	schemeIri, topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '',
	created: '', modified: '', deprecatedOn: '', broader: [], related: [], mappings: [], ...over
});

describe('buildSchemeRows (STORY-449)', () => {
	const schemes = [scheme('urn:b', 'Beta', '2026-11-01T10:00:00Z'), scheme('http://x/vocab#Alpha', '')];
	const concepts = [
		concept('urn:c1', 'urn:b', { topConcept: true }),
		concept('urn:c2', 'urn:b', { broader: ['urn:c1'] }),
		concept('urn:c3', 'urn:b'),
		concept('urn:c4', 'urn:b', { status: 'retired' }),
		concept('urn:c5', 'http://x/vocab#Alpha', { topConcept: true })
	];

	it('counts all concepts, top concepts and orphans per scheme, sorted by display name', () => {
		const rows = buildSchemeRows(schemes, concepts);
		expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
		const beta = rows[1];
		expect(beta).toMatchObject({ conceptCount: 4, topConceptCount: 1, orphanCount: 1, modified: '2026-11-01T10:00:00Z' });
		expect(rows[0]).toMatchObject({ conceptCount: 1, topConceptCount: 1, orphanCount: 0, modified: '' });
	});

	it('gives a scheme without concepts zero counts', () => {
		expect(buildSchemeRows([scheme('urn:e', 'Empty')], [])[0]).toMatchObject({ conceptCount: 0, topConceptCount: 0, orphanCount: 0 });
	});
});

describe('filterSchemeRows', () => {
	const rows = buildSchemeRows([scheme('urn:a', 'Business glossary'), scheme('urn:b', 'Products')], []);
	it('matches the name ignoring case and accents, and returns all for an empty search', () => {
		expect(filterSchemeRows(rows, 'GLOSS').map((r) => r.name)).toEqual(['Business glossary']);
		expect(filterSchemeRows(rows, '  ')).toHaveLength(2);
		expect(filterSchemeRows(rows, 'zzz')).toEqual([]);
	});
});
