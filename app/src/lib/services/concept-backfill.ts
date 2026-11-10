/**
 * Backfilling the vocabulary from existing classes (ontology-pipeline STORY-326): for classes that have no
 * defining concept yet, propose one `proposed` concept each, reusing a concept that already carries the
 * label. Pure; the writes are `SparqlConnector.createConceptsForClasses`.
 */
import { SCHEMA_NAMESPACE } from '#lib/config.js';
import { conceptIri } from '#lib/utils/iri.js';
import { normaliseLabel, validateConceptDraft, type Concept, type ConceptDraft } from './skos-concept.js';
import type { FetchedClass } from './sparql-connector.js';

export interface BackfillProposal {
	classIri: string;
	namespaceBaseIri: string;
	/** Proposed preferred label of the new concept (the class label). */
	label: string;
	definition: string;
	/** `create` mints a new concept, `link` points the class at one that already exists. */
	action: 'create' | 'link';
	conceptIri: string;
}

/** A row as the user accepts it, label and definition possibly edited. */
export interface BackfillRow {
	classIri: string;
	namespaceBaseIri: string;
	label: string;
	definition: string;
}

export interface BackfillWrite {
	classIri: string;
	namespaceBaseIri: string;
	conceptIri: string;
	/** Present when the concept does not exist yet. */
	create?: ConceptDraft;
}

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];

const preferredNorm = (c: Concept) => c.prefLabels.map((l) => normaliseLabel(l.text)).filter(Boolean);

/** The concept to reuse for `label`: a live concept with that preferred label, else a concept that already
 *  holds the IRI the label would mint. */
function existingFor(label: string, concepts: Concept[], coreBaseIri: string): string | null {
	const wanted = normaliseLabel(label);
	const byLabel = concepts.find((c) => LIVE.includes(c.status) && preferredNorm(c).includes(wanted));
	if (byLabel) return byLabel.iri;
	const minted = conceptIri(label.trim(), '', coreBaseIri);
	return concepts.some((c) => c.iri === minted) ? minted : null;
}

function emptyDraft(label: string, definition: string): ConceptDraft {
	return {
		prefLabels: [{ text: label.trim(), lang: 'en' }],
		altLabels: [],
		hiddenLabels: [],
		definition: definition.trim(),
		scopeNote: '',
		disambiguation: '',
		schemeIri: '',
		topConcept: false,
		status: 'proposed',
		source: '',
		authority: '',
		replacedBy: '',
		deprecationReason: ''
	};
}

/** One proposal per class that has no concept: link to an existing concept with the same label, else
 *  create one. Classes of the application itself are left out, and so are already-linked ones, which
 *  makes a rerun propose nothing. */
export function proposeBackfill(classes: FetchedClass[], concepts: Concept[], coreBaseIri: string): BackfillProposal[] {
	const planned = new Map<string, string>(); // normalised label -> concept IRI minted in this run
	const proposals: BackfillProposal[] = [];
	const unlinked = classes
		.filter((c) => !c.definedByConcept && !c.iri.startsWith(SCHEMA_NAMESPACE))
		.sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri));
	for (const c of unlinked) {
		const norm = normaliseLabel(c.label);
		const existing = existingFor(c.label, concepts, coreBaseIri) ?? planned.get(norm) ?? null;
		const iri = existing ?? conceptIri(c.label.trim(), '', coreBaseIri);
		if (!existing) planned.set(norm, iri);
		proposals.push({
			classIri: c.iri,
			namespaceBaseIri: c.namespaceBaseIri,
			label: c.label,
			definition: c.comment?.trim() ?? '',
			action: existing ? 'link' : 'create',
			conceptIri: iri
		});
	}
	return proposals;
}

/** Turns accepted rows into writes. A row whose label matches an existing concept, or one created
 *  earlier in the same batch, links instead of creating; an unacceptable row is reported, not written. */
export function planBackfillWrites(
	rows: BackfillRow[],
	concepts: Concept[],
	coreBaseIri: string
): { writes: BackfillWrite[]; errors: { classIri: string; message: string }[] } {
	const writes: BackfillWrite[] = [];
	const errors: { classIri: string; message: string }[] = [];
	const planned = new Map<string, string>();
	for (const row of rows) {
		if (!row.label.trim()) {
			errors.push({ classIri: row.classIri, message: 'The concept needs a label.' });
			continue;
		}
		const norm = normaliseLabel(row.label);
		const existing = existingFor(row.label, concepts, coreBaseIri) ?? planned.get(norm) ?? null;
		if (existing) {
			writes.push({ classIri: row.classIri, namespaceBaseIri: row.namespaceBaseIri, conceptIri: existing });
			continue;
		}
		const draft = emptyDraft(row.label, row.definition);
		const problem = validateConceptDraft(draft)[0];
		if (problem) {
			errors.push({ classIri: row.classIri, message: problem });
			continue;
		}
		const iri = conceptIri(row.label.trim(), '', coreBaseIri);
		planned.set(norm, iri);
		writes.push({ classIri: row.classIri, namespaceBaseIri: row.namespaceBaseIri, conceptIri: iri, create: draft });
	}
	return { writes, errors };
}
