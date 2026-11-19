import { describe, expect, it } from 'vitest';
import { PROMOTE_STAY_CRITERIA, PROMOTE_CRITERIA, promoteGuidance, planEnumeratedClass } from './concept-to-class';
import type { Concept } from './skos-concept';
import type { SkosCollection } from './skos-collection';

const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', disambiguation: '',
	schemeIri: 's', topConcept: false, status: 'active', source: '', authority: '', replacedBy: '', deprecationReason: '', created: '',
	modified: '', deprecatedOn: '', ...over
});
const col = (id: string, members: string[], over: Partial<SkosCollection> = {}): SkosCollection => ({
	iri: `urn:col:${id}`, prefLabels: [{ text: id, lang: 'en' }], ordered: false, members, ...over
});

describe('promoteGuidance (STORY-424)', () => {
	it('always gives both criteria lists and an example', () => {
		const g = promoteGuidance(c('Customer'));
		expect(g.stay).toEqual(PROMOTE_STAY_CRITERIA);
		expect(g.promote).toEqual(PROMOTE_CRITERIA);
		expect(g.example.length).toBeGreaterThan(10);
		expect(PROMOTE_STAY_CRITERIA.join(' ')).toMatch(/status|tag|capabilit/i);
		expect(PROMOTE_CRITERIA.join(' ')).toMatch(/propert|restriction|subclass/i);
	});

	it('leans towards keeping a status-like or tag-like concept, and never blocks', () => {
		expect(promoteGuidance(c('Order status')).lean).toBe('keep');
		expect(promoteGuidance(c('Priority tag')).lean).toBe('keep');
		expect(promoteGuidance(c('Customer', { definition: 'Has properties such as address; every customer must have an owner.' })).lean).toBe('promote');
		expect(promoteGuidance(c('Customer')).lean).toBeNull();
	});
});

describe('planEnumeratedClass (STORY-424)', () => {
	const concepts = [c('Low'), c('High'), c('Mid'), c('Old', { status: 'retired' })];

	it('maps the concepts of a collection, in order, to members', () => {
		const p = planEnumeratedClass(col('Priority', ['urn:c:High', 'urn:c:Low'], { ordered: true }), [], concepts);
		expect(p.error).toBeNull();
		expect(p.className).toBe('Priority');
		expect(p.members).toEqual([{ label: 'High', conceptIri: 'urn:c:High' }, { label: 'Low', conceptIri: 'urn:c:Low' }]);
	});

	it('includes the concepts of nested collections once and survives cycles', () => {
		const inner = col('Inner', ['urn:c:Mid', 'urn:c:Low']);
		const outer = col('Outer', ['urn:c:Low', inner.iri, 'urn:col:Outer']);
		const p = planEnumeratedClass(outer, [inner, outer], concepts);
		expect(p.members.map((m) => m.label)).toEqual(['Low', 'Mid']);
	});

	it('refuses an empty collection, retired-only members and a class that already exists', () => {
		expect(planEnumeratedClass(col('Empty', []), [], concepts).error).toMatch(/no concepts/i);
		expect(planEnumeratedClass(col('Gone', ['urn:c:Old']), [], concepts).error).toMatch(/no concepts/i);
		expect(planEnumeratedClass(col('Priority', ['urn:c:Low']), [], concepts, { classExists: () => true }).error).toMatch(/already exists/);
	});
});
