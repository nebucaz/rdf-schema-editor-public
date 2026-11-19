import { describe, expect, it } from 'vitest';
import { planMerge, type MergeInput } from './concept-merge';
import type { Concept } from './skos-concept';

const c = (id: string, over: Partial<Concept> = {}): Concept => ({
	iri: `urn:c:${id}`, prefLabels: [{ text: id, lang: 'en' }], altLabels: [], hiddenLabels: [], definition: '',
	scopeNote: '', disambiguation: '', schemeIri: 'urn:s:1', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '', ...over
});
const i = (id: string) => `urn:c:${id}`;
const merge = (concepts: Concept[], over: Partial<MergeInput> = {}) =>
	planMerge({ concepts, collections: [], classLinks: [], survivor: i('s'), duplicate: i('d'), ...over });

describe('planMerge (STORY-423)', () => {
	it('refuses a merge into itself, an unknown concept or a retired survivor', () => {
		expect(merge([c('s')], { duplicate: i('s') }).error).toMatch(/itself/);
		expect(merge([c('s')]).error).toMatch(/not found/);
		expect(merge([c('s', { status: 'retired' }), c('d')]).error).toMatch(/retired|deprecated/);
		expect(merge([c('s'), c('d', { status: 'retired' })]).error).toMatch(/already/);
	});

	it('moves labels: a preferred label in a language the survivor lacks stays preferred, otherwise becomes alternative', () => {
		const plan = merge([
			c('s', { altLabels: [{ text: 'Same', lang: 'en' }] }),
			c('d', {
				prefLabels: [{ text: 'Dup', lang: 'en' }, { text: 'Doppel', lang: 'de' }],
				altLabels: [{ text: 'same', lang: 'en' }, { text: 'Other', lang: 'en' }],
				hiddenLabels: [{ text: 'dupp', lang: 'en' }]
			})
		]);
		const d = plan.survivorDraft;
		expect(d.prefLabels).toEqual([{ text: 's', lang: 'en' }, { text: 'Doppel', lang: 'de' }]);
		expect(d.altLabels.map((l) => l.text).sort()).toEqual(['Dup', 'Other', 'Same']);
		expect(d.hiddenLabels.map((l) => l.text)).toEqual(['dupp']);
	});

	it('takes a definition the survivor lacks, and asks when two differ', () => {
		expect(merge([c('s'), c('d', { definition: 'From dup.' })]).survivorDraft.definition).toBe('From dup.');
		const plan = merge([c('s', { definition: 'Mine.' }), c('d', { definition: 'Theirs.' })]);
		expect(plan.conflicts).toEqual([{ field: 'definition', survivor: 'Mine.', duplicate: 'Theirs.', resolved: false }]);
		expect(plan.survivorDraft.definition).toBe('Mine.');
		const chosen = merge([c('s', { definition: 'Mine.' }), c('d', { definition: 'Theirs.' })], { decisions: { definition: 'duplicate' } });
		expect(chosen.survivorDraft.definition).toBe('Theirs.');
		expect(chosen.conflicts[0].resolved).toBe(true);
	});

	it('asks about two different notations', () => {
		const concepts = [c('s', { notation: ['A1'] }), c('d', { notation: ['B2'] })];
		expect(merge(concepts).conflicts.map((x) => x.field)).toEqual(['notation']);
		expect(merge(concepts, { decisions: { notation: 'both' } }).survivorDraft.notation).toEqual(['A1', 'B2']);
		expect(merge(concepts, { decisions: { notation: 'survivor' } }).survivorDraft.notation).toEqual(['A1']);
		expect(merge([c('s'), c('d', { notation: ['B2'] })]).survivorDraft.notation).toEqual(['B2']);
	});

	it('moves broader, related, mappings and retargets incoming links', () => {
		const plan = merge([
			c('s'),
			c('p', { topConcept: true }),
			c('d', { broader: [i('p')], related: [i('r1')], mappings: [{ kind: 'exactMatch', target: 'urn:ext:1' }] }),
			c('r1'),
			c('r2', { related: [i('d')] }),
			c('child', { broader: [i('d')] }),
			c('m', { mappings: [{ kind: 'closeMatch', target: i('d') }] }),
			c('old', { replacedBy: i('d'), status: 'deprecated' })
		]);
		expect(plan.addBroader).toEqual([i('p')]);
		expect(plan.addRelated).toEqual([i('r1'), i('r2')]);
		expect(plan.addMappings).toEqual([{ kind: 'exactMatch', target: 'urn:ext:1' }]);
		expect(plan.incomingBroader).toEqual([{ concept: i('child'), keep: true }]);
		expect(plan.incomingRelated).toEqual([i('r2')]);
		expect(plan.incomingMappings).toEqual([{ concept: i('m'), kind: 'closeMatch', keep: true }]);
		expect(plan.incomingReplacedBy).toEqual([{ concept: i('old'), keep: true }]);
	});

	it('drops outcomes that would make a cycle, a self link or a duplicate triple', () => {
		const plan = merge([
			c('s', { broader: [i('p')], related: [i('r')] }),
			// d lists the survivor as its parent and as related; its parent p is a child of s -> cycle
			c('d', { broader: [i('s'), i('p'), i('q')], related: [i('s'), i('r'), i('x')] }),
			c('p', { broader: [i('s')] }),
			c('q'),
			c('r'),
			c('x'),
			// survivor is below the duplicate: that edge disappears
			c('top'),
			c('below', { broader: [i('d')] })
		]);
		expect(plan.addBroader).toEqual([i('q')]);
		expect(plan.addRelated).toEqual([i('x')]);
		expect(plan.dropped.length).toBeGreaterThanOrEqual(3);
		// a narrower concept of d that is an ancestor of s would make a cycle
		const cyc = merge([c('s', { broader: [i('a')] }), c('d'), c('a', { broader: [i('d')] })]);
		expect(cyc.incomingBroader).toEqual([{ concept: i('a'), keep: false }]);
		// the survivor below the duplicate: its edge to d goes away without a self link
		const below = merge([c('s', { broader: [i('d')] }), c('d')]);
		expect(below.incomingBroader).toEqual([{ concept: i('s'), keep: false }]);
	});

	it('moves collection memberships, keeping order and avoiding duplicate members', () => {
		const plan = merge([c('s'), c('d'), c('x')], {
			collections: [
				{ iri: 'urn:col:1', prefLabels: [], ordered: true, members: [i('x'), i('d')] },
				{ iri: 'urn:col:2', prefLabels: [], ordered: false, members: [i('d'), i('s')] },
				{ iri: 'urn:col:3', prefLabels: [], ordered: false, members: [i('x')] }
			]
		});
		expect(plan.collections).toEqual([
			{ iri: 'urn:col:1', ordered: true, members: [i('x'), i('s')] },
			{ iri: 'urn:col:2', ordered: false, members: [i('s')] }
		]);
	});

	it('retargets classes that point to the duplicate', () => {
		const plan = merge([c('s'), c('d')], { classLinks: [{ classIri: 'http://e#K', label: 'K' }] });
		expect(plan.classLinks).toEqual([{ classIri: 'http://e#K', label: 'K' }]);
	});

	it('warns about a merge into another scheme and adopts the scheme when the survivor has none', () => {
		const other = merge([c('s', { schemeIri: 'urn:s:2' }), c('d')]);
		expect(other.warnings.join(' ')).toMatch(/another scheme/);
		const none = merge([c('s', { schemeIri: '' }), c('d', { topConcept: true })]);
		expect(none.survivorDraft.schemeIri).toBe('urn:s:1');
		expect(none.survivorDraft.topConcept).toBe(true);
	});

	it('lists everything that moves for the preview and is stable', () => {
		const concepts = [c('s'), c('d', { altLabels: [{ text: 'D2', lang: 'en' }], related: [i('r')] }), c('r')];
		const plan = merge(concepts, { classLinks: [{ classIri: 'http://e#K', label: 'K' }] });
		const text = plan.moves.join('\n');
		expect(text).toMatch(/D2/);
		expect(text).toMatch(/K/);
		expect(merge([...concepts].reverse(), { classLinks: [{ classIri: 'http://e#K', label: 'K' }] })).toEqual(plan);
	});
});
