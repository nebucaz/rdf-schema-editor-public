import { describe, expect, it } from 'vitest';
import type { Concept } from '../skos-concept';
import type { FetchedSchema } from '../sparql-connector';
import { GATES, runGates } from './index';
import { gateFindingLink } from './links';
import { SCHEME_HEALTH_GATES } from './scheme-health';

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`,
	prefLabels: [{ text: id.toUpperCase(), lang: 'en' }],
	altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }], scopeNotes: [], disambiguation: '',
	schemeIri: 'urn:scheme:a', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	broader: [], related: [], mappings: [],
	...over
});
const schema = { classes: [], subClassOf: [], individuals: [], objectProperties: [] } as unknown as FetchedSchema;
const run = (concepts: Concept[] | undefined, gateId?: string) =>
	runGates(schema, { concepts }, SCHEME_HEALTH_GATES).filter((f) => !gateId || f.gateId === gateId);

describe('scheme health gates (ontology-dashboard STORY-459)', () => {
	it('are registered', () => {
		for (const id of ['orphan-concept', 'disconnected-cluster', 'undefined-reference']) {
			expect(GATES.some((g) => g.id === id)).toBe(true);
		}
	});

	it('are silent without a vocabulary', () => {
		expect(run(undefined)).toEqual([]);
	});

	it('are silent on a connected scheme', () => {
		expect(run([concept('top', { topConcept: true }), concept('kid', { broader: ['urn:c:top'] })])).toEqual([]);
	});

	it('reports a concept with no relation exactly once, as a warning on the concept', () => {
		const found = run([concept('top', { topConcept: true }), concept('kid', { broader: ['urn:c:top'] }), concept('lonely')]);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ gateId: 'orphan-concept', severity: 'warning', elementIri: 'urn:c:lonely' });
		expect(found[0].message).toContain('LONELY');
	});

	it('does not report a lone top concept', () => {
		expect(run([concept('top', { topConcept: true })])).toEqual([]);
	});

	it('reports every cluster beyond the largest, by its first member', () => {
		const found = run(
			[
				concept('a', { topConcept: true }), concept('b', { broader: ['urn:c:a'] }), concept('c', { broader: ['urn:c:a'] }),
				concept('x', { topConcept: true }), concept('y', { broader: ['urn:c:x'] })
			],
			'disconnected-cluster'
		);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ elementIri: 'urn:c:x', severity: 'warning' });
		expect(found[0].message).toContain('2 concepts');
	});

	it('reports a reference to a concept that is not in the vocabulary', () => {
		const found = run([concept('top', { topConcept: true, related: ['urn:c:ghost'] })], 'undefined-reference');
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ elementIri: 'urn:c:top' });
		expect(found[0].message).toContain('urn:c:ghost');
	});

	it('links each finding to its concept', () => {
		const [f] = run([concept('top', { topConcept: true }), concept('lonely')], 'orphan-concept');
		expect(gateFindingLink(f, schema)).toBe('/vocabulary?concept=urn%3Ac%3Alonely');
	});
});
