/**
 * Multi-step actions of the Vocabulary area (ontology-pipeline STORY-323), kept out of the page so
 * they can be tested without a connector: the connector methods they need are injected.
 */

import { addAlternativeLabel, moveLabelToReplacement, type Concept, type ConceptDraft, type ConceptStatus } from './skos-concept.js';

export interface VocabularyDeps {
	setConceptStatus: (
		coreBaseIri: string,
		iri: string,
		to: ConceptStatus,
		extra?: { reason?: string; replacedBy?: string }
	) => Promise<void>;
	updateConcept: (coreBaseIri: string, iri: string, draft: ConceptDraft) => Promise<void>;
}

/** Deprecates `concept`; when asked, the old preferred label also becomes a hidden label of the
 *  replacement (book pp. 51, 135). The replacement is only touched after the status change succeeded. */
export async function deprecateConcept(
	deps: VocabularyDeps,
	coreBaseIri: string,
	concept: Concept,
	choice: { reason: string; replacedBy: string; moveLabel: boolean },
	all: Concept[]
): Promise<void> {
	await deps.setConceptStatus(coreBaseIri, concept.iri, 'deprecated', {
		reason: choice.reason,
		replacedBy: choice.replacedBy
	});
	if (!choice.replacedBy || !choice.moveLabel) return;
	const replacement = all.find((c) => c.iri === choice.replacedBy);
	const moved = replacement ? moveLabelToReplacement(concept, replacement) : null;
	if (replacement && moved) await deps.updateConcept(coreBaseIri, replacement.iri, moved);
}

/** Records `text` as an alternative label of an existing concept (the "add as alternative label" answer
 *  to the duplicate check). */
export async function addAlternativeToConcept(
	deps: Pick<VocabularyDeps, 'updateConcept'>,
	coreBaseIri: string,
	all: Concept[],
	conceptIri: string,
	text: string,
	lang: string
): Promise<void> {
	const target = all.find((c) => c.iri === conceptIri);
	if (!target) throw new Error(`Concept ${conceptIri} not found`);
	const next = addAlternativeLabel(target, text, lang);
	if (next !== target) await deps.updateConcept(coreBaseIri, conceptIri, next);
}

/** Every concept of the core vocabulary, read a page at a time (one query per page, never per concept),
 *  or `null` when no namespace is marked as the vocabulary namespace. The page cap keeps a runaway
 *  vocabulary from looping. */
export async function loadAllConcepts(
	deps: {
		fetchVocabularyNamespace: () => Promise<string | null>;
		fetchConcepts: (core: string, options: { limit: number; offset: number }) => Promise<{ concepts: Concept[]; hasMore: boolean }>;
	},
	pageSize = 1000,
	maxPages = 10
): Promise<Concept[] | null> {
	const core = await deps.fetchVocabularyNamespace();
	if (!core) return null;
	const all: Concept[] = [];
	for (let page = 0; page < maxPages; page++) {
		const { concepts, hasMore } = await deps.fetchConcepts(core, { limit: pageSize, offset: all.length });
		all.push(...concepts);
		if (!hasMore) break;
	}
	return all;
}
