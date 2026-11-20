import { describe, expect, it } from 'vitest';
import { analyseSchemeHealth, schemeHealthDebt } from './scheme-health';
import type { Concept } from './skos-concept';

const S = 'urn:s:a';
const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definitions: [{ text: 'd', lang: '' }],
	scopeNotes: [], disambiguation: '', schemeIri: S, topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});
const iri = (id: string) => `urn:c:${id}`;
const report = (concepts: Concept[]) => analyseSchemeHealth(concepts)[0];

describe('analyseSchemeHealth (STORY-422)', () => {
	it('returns an empty report for no concepts', () => {
		expect(analyseSchemeHealth([])).toEqual([]);
	});

	it('orphan = no relation at all and not a top concept', () => {
		const r = report([
			c('top', { topConcept: true }),
			c('child', { broader: [iri('top')] }),
			c('lonely'),
			c('rel', { related: [iri('child')] }),
			c('mapped', { mappings: [{ kind: 'exactMatch', target: 'urn:ext:1' }] })
		]);
		expect(r.orphans).toEqual([iri('lonely')]);
	});

	it('a top concept without relations is counted, not listed as an orphan', () => {
		const r = report([c('top', { topConcept: true }), c('other', { topConcept: true })]);
		expect(r.orphans).toEqual([]);
		expect(r.topConceptsWithoutRelation).toBe(2);
		expect('withoutRelation' in r).toBe(false);
	});

	it('an orphan appears once and is not counted among the lone top concepts', () => {
		const r = report([c('top', { topConcept: true }), c('lonely')]);
		expect(r.orphans).toEqual([iri('lonely')]);
		expect(r.topConceptsWithoutRelation).toBe(1);
	});

	it('finds disconnected clusters, largest first', () => {
		const r = report([
			c('a', { topConcept: true }),
			c('b', { broader: [iri('a')] }),
			c('c', { broader: [iri('a')] }),
			c('x', { topConcept: true }),
			c('y', { related: [iri('x')] }),
			c('solo')
		]);
		expect(r.clusters.map((k) => k.length)).toEqual([3, 2, 1]);
		expect(r.clusters[0]).toEqual([iri('a'), iri('b'), iri('c')]);
	});

	it('lists related pairs that the hierarchy already implies', () => {
		const r = report([
			c('a', { topConcept: true }),
			c('b', { broader: [iri('a')] }),
			c('d', { broader: [iri('b')], related: [iri('a')] }),
			c('e', { broader: [iri('a')], related: [iri('b')] })
		]);
		expect(r.transitiveRelated).toEqual([[iri('a'), iri('d')]]);
	});

	it('computes average depth and branching factor, and lists polyhierarchy', () => {
		const r = report([
			c('a', { topConcept: true }),
			c('b', { broader: [iri('a')] }),
			c('d', { broader: [iri('a')] }),
			c('e', { broader: [iri('b'), iri('d')] })
		]);
		// depths 0,1,1,2 -> 1; parents a(2 children), b(1), d(1) -> 4/3
		expect(r.averageDepth).toBe(1);
		expect(r.averageBranching).toBeCloseTo(4 / 3);
		expect(r.polyhierarchy).toEqual([iri('e')]);
	});

	it('reports references to concepts that do not exist', () => {
		const r = report([c('a', { topConcept: true, related: ['urn:c:ghost'] }), c('b', { broader: ['urn:c:gone'] })]);
		expect(r.undefinedReferences).toEqual([
			{ concept: iri('a'), target: 'urn:c:ghost' },
			{ concept: iri('b'), target: 'urn:c:gone' }
		]);
	});

	it('survives a broader cycle and ignores deprecated concepts', () => {
		const r = report([
			c('a', { broader: [iri('b')] }),
			c('b', { broader: [iri('a')] }),
			c('old', { status: 'retired' })
		]);
		expect(r.conceptCount).toBe(2);
		expect(r.averageDepth).toBe(0);
	});

	it('is stable and sorted per scheme', () => {
		const out = analyseSchemeHealth([c('z', { schemeIri: 'urn:s:z' }), c('a', { schemeIri: 'urn:s:a' })]);
		expect(out.map((x) => x.schemeIri)).toEqual(['urn:s:a', 'urn:s:z']);
		expect(analyseSchemeHealth([c('z'), c('a')])).toEqual(analyseSchemeHealth([c('a'), c('z')]));
	});

	it('turns the defects into debt items', () => {
		const debt = schemeHealthDebt(analyseSchemeHealth([c('top', { topConcept: true, related: ['urn:c:ghost', iri('w')] }), c('w'), c('lonely'), c('x', { topConcept: true }), c('y', { broader: [iri('x')] })]));
		const kinds = debt.map((d) => `${d.kind}:${d.concept}`);
		expect(kinds).toContain(`orphan-concept:${iri('lonely')}`);
		expect(kinds).toContain(`undefined-reference:${iri('top')}`);
		expect(kinds.some((k) => k.startsWith('disconnected-cluster'))).toBe(true);
	});
});
