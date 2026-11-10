/**
 * The change log's shape and the pure helpers that describe a change (ontology-pipeline STORY-331).
 * Entries are stored by the backend (`POST /changelog`), which stamps author, time and the version the
 * change was made in; nothing here writes.
 */
import { conceptTitle, type Concept, type ConceptDraft, type LangText } from './skos-concept';

/** What a change did to the model; the release dialog derives the version bump from it (STORY-333). Mirrors the backend. */
export const CHANGE_KINDS = ['label', 'comment', 'addition', 'removal', 'rename', 'domain-range', 'disjointness', 'other'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** What a client may send: no author, no time. */
export interface ChangeLogEntryInput {
	kind: 'change' | 'release';
	summary: string;
	rationale?: string;
	/** IRI of the concept, class or property changed. */
	term?: string;
	/** IRI of the competency question that justifies the change. */
	question?: string;
	changeKind?: ChangeKind;
	/** Required for a release; a change is filed under the namespace's current version by the server. */
	version?: string;
	/** The namespace whose version a release sets. */
	namespace?: string;
}

export interface ChangeLogItem {
	iri: string;
	kind: 'change' | 'release';
	summary: string;
	rationale: string;
	term: string;
	question: string;
	changeKind: ChangeKind | '';
	version: string;
	changedBy: string;
	changedAt: string;
}

export interface ChangeLogFilter {
	term?: string;
	question?: string;
	version?: string;
}

const labelKey = (labels: LangText[]) => JSON.stringify(labels.map((l) => [l.text.trim(), l.lang]).sort());

type Editable = Pick<
	ConceptDraft,
	'prefLabels' | 'altLabels' | 'hiddenLabels' | 'definition' | 'scopeNote' | 'disambiguation' | 'source' | 'authority' | 'schemeIri' | 'topConcept' | 'replacedBy'
>;

/** `label` when only labels changed, `comment` when a text changed, otherwise `other`. */
export function changeKindForConceptEdit(before: Editable, after: Editable): ChangeKind {
	const structural = before.schemeIri !== after.schemeIri || before.topConcept !== after.topConcept || before.replacedBy !== after.replacedBy;
	if (structural) return 'other';
	const texts =
		before.definition !== after.definition ||
		before.scopeNote !== after.scopeNote ||
		before.disambiguation !== after.disambiguation ||
		before.source !== after.source ||
		before.authority !== after.authority;
	if (texts) return 'comment';
	const labels =
		labelKey(before.prefLabels) !== labelKey(after.prefLabels) ||
		labelKey(before.altLabels) !== labelKey(after.altLabels) ||
		labelKey(before.hiddenLabels) !== labelKey(after.hiddenLabels);
	return labels ? 'label' : 'other';
}

export function conceptChangeSummary(action: 'added' | 'edited' | 'deprecated' | 'deleted' | 'promoted', concept: Pick<Concept, 'prefLabels' | 'disambiguation'>): string {
	const verb = action[0].toUpperCase() + action.slice(1);
	return `${verb} concept "${conceptTitle(concept)}"`;
}

export function classCreatedEntry(iri: string, name: string, rationale: string): ChangeLogEntryInput {
	return { kind: 'change', summary: `Added class "${name}"`, rationale, term: iri, changeKind: 'addition' };
}

export function classDeletedEntry(iri: string, name: string, rationale: string): ChangeLogEntryInput {
	return { kind: 'change', summary: `Deleted class "${name}"`, rationale, term: iri, changeKind: 'removal' };
}

/** One entry per kind of change, so a rename and a new description are not blurred into one. */
export function classEditEntries(
	iri: string,
	before: { name: string; description: string },
	after: { name: string; description: string },
	rationale: string
): ChangeLogEntryInput[] {
	const entries: ChangeLogEntryInput[] = [];
	if (before.name !== after.name) {
		entries.push({ kind: 'change', summary: `Renamed class "${before.name}" to "${after.name}"`, rationale, term: iri, changeKind: 'rename' });
	}
	if (before.description !== after.description) {
		entries.push({ kind: 'change', summary: `Changed the description of class "${after.name}"`, rationale, term: iri, changeKind: 'comment' });
	}
	return entries;
}

export function relationEntry(
	action: 'added' | 'removed',
	concept: Pick<Concept, 'iri' | 'prefLabels' | 'disambiguation'>,
	relation: string,
	target: string,
	rationale: string
): ChangeLogEntryInput {
	const verb = action === 'added' ? 'Added' : 'Removed';
	return {
		kind: 'change',
		summary: `${verb} ${relation} from concept "${conceptTitle(concept)}" to ${target}`,
		rationale,
		term: concept.iri,
		changeKind: action === 'added' ? 'addition' : 'removal'
	};
}
