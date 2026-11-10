import { describe, expect, it, vi } from 'vitest';
import { addAlternativeToConcept, deprecateConcept, loadAllConcepts, type VocabularyDeps } from './vocabulary-actions';
import type { Concept } from './skos-concept';

const CORE = 'http://e/core';
const concept = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [], hiddenLabels: [], definition: 'd', scopeNote: '', disambiguation: '',
	schemeIri: '', topConcept: false, status: 'active', source: '', authority: '',
	replacedBy: '', deprecationReason: '', created: '', modified: '', deprecatedOn: '',
	...over
});

const deps = (): VocabularyDeps & { calls: string[] } => {
	const calls: string[] = [];
	return {
		calls,
		setConceptStatus: vi.fn(async (_c, iri, to) => void calls.push(`status ${iri} ${to}`)),
		updateConcept: vi.fn(async (_c, iri) => void calls.push(`update ${iri}`))
	};
};

describe('deprecateConcept (STORY-323)', () => {
	const old = concept('urn:old', 'Client');
	const replacement = concept('urn:new', 'Customer');

	it('deprecates with the reason and replacement, then adds the old label to the replacement', async () => {
		const d = deps();
		await deprecateConcept(d, CORE, old, { reason: 'Merged', replacedBy: 'urn:new', moveLabel: true }, [old, replacement]);
		expect(d.setConceptStatus).toHaveBeenCalledWith(CORE, 'urn:old', 'deprecated', { reason: 'Merged', replacedBy: 'urn:new' });
		expect(d.updateConcept).toHaveBeenCalledWith(
			CORE,
			'urn:new',
			expect.objectContaining({ hiddenLabels: [{ text: 'Client', lang: 'en' }] })
		);
		expect(d.calls).toEqual(['status urn:old deprecated', 'update urn:new']);
	});

	it('leaves the replacement alone when the label is not to be moved or already known', async () => {
		const d = deps();
		await deprecateConcept(d, CORE, old, { reason: 'Merged', replacedBy: 'urn:new', moveLabel: false }, [old, replacement]);
		expect(d.updateConcept).not.toHaveBeenCalled();

		const known = concept('urn:new', 'Customer', { altLabels: [{ text: 'Client', lang: 'en' }] });
		await deprecateConcept(d, CORE, old, { reason: 'Merged', replacedBy: 'urn:new', moveLabel: true }, [old, known]);
		expect(d.updateConcept).not.toHaveBeenCalled();
	});

	it('deprecates without a replacement and touches nothing else', async () => {
		const d = deps();
		await deprecateConcept(d, CORE, old, { reason: 'Unused', replacedBy: '', moveLabel: false }, [old]);
		expect(d.setConceptStatus).toHaveBeenCalledWith(CORE, 'urn:old', 'deprecated', { reason: 'Unused', replacedBy: '' });
		expect(d.updateConcept).not.toHaveBeenCalled();
	});

	it('does not touch the replacement when the status change fails', async () => {
		const d = deps();
		d.setConceptStatus = vi.fn(async () => {
			throw new Error('A concept cannot go from proposed to deprecated');
		});
		await expect(
			deprecateConcept(d, CORE, old, { reason: 'x', replacedBy: 'urn:new', moveLabel: true }, [old, replacement])
		).rejects.toThrow(/cannot go/);
		expect(d.updateConcept).not.toHaveBeenCalled();
	});
});

describe('addAlternativeToConcept (STORY-323)', () => {
	it('stores the typed term as an alternative label of the existing concept', async () => {
		const d = deps();
		const existing = concept('urn:1', 'Customer');
		await addAlternativeToConcept(d, CORE, [existing], 'urn:1', 'Customers', 'en');
		expect(d.updateConcept).toHaveBeenCalledWith(
			CORE,
			'urn:1',
			expect.objectContaining({ altLabels: [{ text: 'Customers', lang: 'en' }] })
		);
	});

	it('does nothing when the concept already carries the term', async () => {
		const d = deps();
		await addAlternativeToConcept(d, CORE, [concept('urn:1', 'Customer')], 'urn:1', 'customer', 'en');
		expect(d.updateConcept).not.toHaveBeenCalled();
	});

	it('fails for an unknown concept', async () => {
		await expect(addAlternativeToConcept(deps(), CORE, [], 'urn:x', 'Term', 'en')).rejects.toThrow(/not found/i);
	});
});

describe('loadAllConcepts (STORY-324)', () => {
	const page = (n: number) => Array.from({ length: n }, (_, i) => concept(`urn:${i}`, `C${i}`));

	it('returns null when no namespace is marked as the vocabulary namespace', async () => {
		const fetchConcepts = vi.fn();
		expect(await loadAllConcepts({ fetchVocabularyNamespace: async () => null, fetchConcepts })).toBeNull();
		expect(fetchConcepts).not.toHaveBeenCalled();
	});

	it('reads page after page until the last one, with one query per page', async () => {
		const fetchConcepts = vi
			.fn()
			.mockResolvedValueOnce({ concepts: page(2), hasMore: true })
			.mockResolvedValueOnce({ concepts: page(1), hasMore: false });
		const all = await loadAllConcepts({ fetchVocabularyNamespace: async () => CORE, fetchConcepts }, 2);
		expect(all).toHaveLength(3);
		expect(fetchConcepts).toHaveBeenNthCalledWith(1, CORE, { limit: 2, offset: 0 });
		expect(fetchConcepts).toHaveBeenNthCalledWith(2, CORE, { limit: 2, offset: 2 });
	});

	it('stops after a page cap so a runaway vocabulary cannot loop', async () => {
		const fetchConcepts = vi.fn(async () => ({ concepts: page(1), hasMore: true }));
		const all = await loadAllConcepts({ fetchVocabularyNamespace: async () => CORE, fetchConcepts }, 1, 3);
		expect(fetchConcepts).toHaveBeenCalledTimes(3);
		expect(all).toHaveLength(3);
	});
});
