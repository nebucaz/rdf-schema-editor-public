/**
 * SKOS import, part 3 (skos-support STORY-417), the pure half: turn a reviewed `ImportPlan` and the user's decisions into the
 * exact writes. New entries are accepted by default; a changed or conflicting entry is kept as it is unless the user chose
 * "take imported"; a new concept can be marked "same as <existing>", which only adds its labels and relations to that concept.
 * New concepts arrive as `proposed` with the file name as `rse:source`. Entries the model would refuse are returned as
 * `rejected` instead of failing the whole import. Nothing here writes.
 */
import { validateConceptDraft, type Concept, type ConceptDraft, type ConceptMapping, type LangText } from './skos-concept';
import type { SkosCollection } from './skos-collection';
import type { ImportPlan, ImportedConcept, ImportedScheme, PlanEntry } from './skos-import';
import type { SkosVocabulary } from './skos-export';
import type { ChangeLogEntryInput } from './change-log';
import { runVocabularyGates } from './gates/vocabulary';
import type { GateFinding } from './gates/types';

export type EntryDecision = 'skip' | 'keep' | 'take';

export interface ImportDecisions {
	/** Per entry IRI; absent means the default for the entry's status. */
	entries?: Record<string, EntryDecision>;
	/** New concept IRI -> the existing concept it is the same as. */
	sameAs?: Record<string, string>;
}

export interface ConceptWrite {
	iri: string;
	mode: 'insert' | 'update';
	/** The complete draft to store (for an update: the existing concept with the imported values merged in). */
	draft: ConceptDraft;
	/** Relations to add; existing ones are never removed. */
	broader: string[];
	related: string[];
	mappings: ConceptMapping[];
}
export interface SchemeWrite {
	iri: string;
	mode: 'insert' | 'update';
	scheme: ImportedScheme;
}
export interface CollectionWrite {
	iri: string;
	mode: 'insert' | 'update';
	/** The final state: labels and members to hold afterwards. */
	collection: SkosCollection;
}

export interface ImportWrites {
	source: string;
	schemes: SchemeWrite[];
	concepts: ConceptWrite[];
	collections: CollectionWrite[];
	rejected: { iri: string; reason: string }[];
	summary: { added: number; changed: number; merged: number; skipped: number };
}

const labelKey = (l: LangText) => `${l.lang.toLowerCase()}\u0000${l.text.trim()}`;
const union = <T>(a: T[], b: T[], key: (x: T) => string = String as unknown as (x: T) => string) => {
	const have = new Set(a.map(key));
	return [...a, ...b.filter((x) => !have.has(key(x)))];
};

function draftOf(c: Concept): ConceptDraft {
	const { prefLabels, altLabels, hiddenLabels, definition, scopeNote, notation, example, editorialNote, disambiguation, schemeIri, topConcept, status, source, authority, replacedBy, deprecationReason } = c;
	return { prefLabels, altLabels, hiddenLabels, definition, scopeNote, notation: notation ?? [], example: example ?? [], editorialNote: editorialNote ?? [], disambiguation, schemeIri, topConcept, status, source, authority, replacedBy, deprecationReason };
}

/** The existing concept with the imported values merged in: additions for lists, replacement for texts and for a label
 *  of the same language ("take imported"). Nothing is removed. */
function mergeConcept(existing: ConceptDraft, imp: ImportedConcept, takeLabels: boolean): ConceptDraft {
	let prefLabels = existing.prefLabels;
	for (const l of imp.prefLabels) {
		const i = prefLabels.findIndex((x) => x.lang.toLowerCase() === l.lang.toLowerCase());
		if (i < 0) prefLabels = [...prefLabels, l];
		else if (takeLabels && prefLabels[i].text.trim() !== l.text.trim()) prefLabels = prefLabels.map((x, j) => (j === i ? l : x));
	}
	return {
		...existing,
		prefLabels,
		altLabels: union(existing.altLabels, imp.altLabels, labelKey),
		hiddenLabels: union(existing.hiddenLabels, imp.hiddenLabels, labelKey),
		definition: imp.definition.trim() || existing.definition,
		scopeNote: imp.scopeNote.trim() || existing.scopeNote,
		notation: union(existing.notation ?? [], imp.notation),
		example: union(existing.example ?? [], imp.example),
		editorialNote: union(existing.editorialNote ?? [], imp.editorialNote),
		schemeIri: imp.schemeIri || existing.schemeIri,
		topConcept: existing.topConcept || imp.topConcept
	};
}

export function selectImportWrites(plan: ImportPlan, existing: SkosVocabulary, decisions: ImportDecisions, source: string): ImportWrites {
	const writes: ImportWrites = { source, schemes: [], concepts: [], collections: [], rejected: [], summary: { added: 0, changed: 0, merged: 0, skipped: 0 } };
	const existingConcepts = new Map(existing.concepts.map((c) => [c.iri, c]));
	const working = new Map<string, { draft: ConceptDraft; write: ConceptWrite }>();
	const decisionOf = (e: PlanEntry): EntryDecision | null => {
		if (e.status === 'unchanged') return null;
		return decisions.entries?.[e.iri] ?? (e.status === 'new' ? 'take' : 'keep');
	};

	const schemeIris = new Map(existing.schemes.map((s) => [s.iri, s]));
	for (const e of plan.entries) {
		const decision = decisionOf(e);
		if (decision === null) continue;
		if (decision !== 'take') { writes.summary.skipped++; continue; }
		if (e.kind === 'scheme') {
			writes.schemes.push({ iri: e.iri, mode: schemeIris.has(e.iri) ? 'update' : 'insert', scheme: e.imported });
			if (e.status === 'new') writes.summary.added++; else writes.summary.changed++;
			continue;
		}
		if (e.kind === 'collection') {
			const prior = existing.collections.find((c) => c.iri === e.iri);
			const final: SkosCollection = prior
				? { ...prior, prefLabels: union(prior.prefLabels, e.imported.prefLabels, labelKey), members: e.imported.ordered && prior.ordered ? e.imported.members : union(prior.members, e.imported.members) }
				: e.imported;
			writes.collections.push({ iri: e.iri, mode: prior ? 'update' : 'insert', collection: final });
			if (prior) writes.summary.changed++; else writes.summary.added++;
			continue;
		}
		const imp = e.imported;
		const target = decisions.sameAs?.[e.iri];
		if (e.status === 'new' && target) {
			const base = working.get(target)?.draft ?? (existingConcepts.get(target) ? draftOf(existingConcepts.get(target)!) : null);
			if (!base) { writes.rejected.push({ iri: e.iri, reason: `The concept ${target} it is marked the same as does not exist` }); continue; }
			const labelsAsAlt: ImportedConcept = { ...imp, prefLabels: [], altLabels: union(imp.prefLabels, imp.altLabels, labelKey), definition: '', scopeNote: '', schemeIri: '', topConcept: false };
			const draft = mergeConcept(base, labelsAsAlt, false);
			const prev = working.get(target)?.write;
			const write: ConceptWrite = {
				iri: target, mode: 'update', draft,
				broader: union(prev?.broader ?? [], imp.broader), related: union(prev?.related ?? [], imp.related),
				mappings: union(prev?.mappings ?? [], imp.mappings, (m) => `${m.kind} ${m.target}`)
			};
			working.set(target, { draft, write });
			writes.summary.merged++;
			continue;
		}
		const prior = existingConcepts.get(e.iri);
		const draft: ConceptDraft = prior
			? mergeConcept(draftOf(prior), imp, true)
			: { ...mergeConcept(emptyDraft(), imp, false), status: 'proposed', source };
		const errors = validateConceptDraft(draft);
		if (errors.length) { writes.rejected.push({ iri: e.iri, reason: errors[0] }); continue; }
		const write: ConceptWrite = { iri: e.iri, mode: prior ? 'update' : 'insert', draft, broader: imp.broader, related: imp.related, mappings: imp.mappings };
		working.set(e.iri, { draft, write });
		if (prior) writes.summary.changed++; else writes.summary.added++;
	}
	for (const { write } of working.values()) {
		if (!writes.concepts.some((c) => c.iri === write.iri)) writes.concepts.push(write);
		else writes.concepts[writes.concepts.findIndex((c) => c.iri === write.iri)] = write;
	}
	return writes;
}

const emptyDraft = (): ConceptDraft => ({
	prefLabels: [], altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', notation: [], example: [], editorialNote: [], disambiguation: '',
	schemeIri: '', topConcept: false, status: 'proposed', source: '', authority: '', replacedBy: '', deprecationReason: ''
});

/** The one change-log entry for a finished import, recorded after the write. */
export function importChangeSummary(writes: ImportWrites): string {
	const { added, changed, merged, skipped } = writes.summary;
	return `Imported "${writes.source}": ${added} added, ${changed} changed, ${merged} merged into existing concepts, ${skipped} skipped`;
}

export function importChangeEntry(writes: ImportWrites): ChangeLogEntryInput {
	return { kind: 'change', summary: importChangeSummary(writes), changeKind: 'import', rationale: `Source: ${writes.source}` };
}

export interface ApplyImportDeps {
	applyImportPlan: (coreBaseIri: string, writes: ImportWrites) => Promise<void>;
	/** Returns a message when the log write failed, else null (see `recordChange`). */
	recordChange: (entry: ChangeLogEntryInput) => Promise<string | null>;
	loadConcepts: () => Promise<Concept[]>;
}

/** Writes the import in one update, then logs it, then runs the vocabulary gates on what was imported. A failing write
 *  throws and logs nothing; a failing log write only comes back as `logProblem`; findings are shown, never blocking. */
export async function applyImport(
	deps: ApplyImportDeps,
	coreBaseIri: string,
	writes: ImportWrites
): Promise<{ logProblem: string | null; findings: GateFinding[] }> {
	await deps.applyImportPlan(coreBaseIri, writes);
	const logProblem = await deps.recordChange(importChangeEntry(writes));
	const imported = new Set(writes.concepts.map((w) => w.iri));
	const findings = runVocabularyGates(await deps.loadConcepts()).filter((f) => imported.has(f.elementIri));
	return { logProblem, findings };
}
