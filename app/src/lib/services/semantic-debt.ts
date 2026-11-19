/**
 * Semantic debt (ontology-pipeline STORY-334; book pp. 315-316, 240): one list of the known quality debts,
 * gathered from the gates and from the data. Read-only and advisory, like the gates: it lists, it does not fix.
 * Pure; the page loads the schema, concepts, questions and runs.
 */
import { appUrl } from '#lib/utils/urls.js';
import { monthsAgo, type DebtSettings } from './debt-settings';
import { latestOutcomes } from './impact-assessment';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question';
import { runGates } from './gates/index';
import { gateFindingLink } from './gates/links';
import { modelClasses } from './gates/link';
import { analyseSchemeHealth, schemeHealthDebt } from './scheme-health';
import { conceptTitle, type Concept } from './skos-concept';
import type { FetchedSchema } from './sparql-connector';

export const DEBT_KINDS = [
	{ kind: 'undefined-term', label: 'Undefined term' },
	{ kind: 'stale-concept', label: 'Concept not reviewed' },
	{ kind: 'unowned-concept', label: 'Unowned concept' },
	{ kind: 'drifted-definition', label: 'Drifted definition' },
	{ kind: 'class-without-shape', label: 'Class without shape' },
	{ kind: 'class-without-question', label: 'Class without question' },
	{ kind: 'failing-question', label: 'Failing question' },
	{ kind: 'overdue-question-review', label: 'Question review overdue' },
	{ kind: 'orphan-concept', label: 'Orphan concept' },
	{ kind: 'disconnected-cluster', label: 'Disconnected concepts' },
	{ kind: 'undefined-reference', label: 'Reference to unknown concept' },
	{ kind: 'concept-property-empty-scheme', label: 'Concept property without concepts' },
	{ kind: 'retired-concept-value', label: 'Retired concept used as a value' },
	{ kind: 'relation-to-skos-concept', label: 'Relation to skos:Concept' }
] as const;

export type DebtKind = (typeof DEBT_KINDS)[number]['kind'];

export interface DebtItem {
	kind: DebtKind;
	elementIri: string;
	label: string;
	detail: string;
	/** Where the element is edited; `null` when nothing links to it. */
	href: string | null;
}

export interface DebtInput {
	schema: FetchedSchema;
	/** The core vocabulary's concepts; `[]` when there is none. */
	concepts: Concept[];
	questions: CompetencyQuestion[];
	runs: CompetencyQuestionRun[];
	settings: DebtSettings;
	now: Date;
}

const GATE_KIND: Record<string, DebtKind> = {
	'concept-without-definition': 'undefined-term',
	'definition-drift': 'drifted-definition',
	'class-without-shape': 'class-without-shape',
	'question-review-overdue': 'overdue-question-review',
	// The foreign-value finding is left out on purpose: Validation reports it already.
	'concept-property-empty-scheme': 'concept-property-empty-scheme',
	'concept-property-retired-value': 'retired-concept-value',
	'relation-to-skos-concept': 'relation-to-skos-concept'
};

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];

export function collectDebt(input: DebtInput): DebtItem[] {
	const { schema, concepts, questions, runs, settings, now } = input;
	const labels = new Map<string, string>([
		...concepts.map((c) => [c.iri, conceptTitle(c)] as const),
		...schema.classes.map((c) => [c.iri, c.label] as const),
		...questions.map((q) => [q.iri, q.question] as const)
	]);
	const labelOf = (iri: string) => labels.get(iri) ?? iri.split(/[#/]/).pop() ?? iri;
	const items: DebtItem[] = [];

	const findings = runGates(schema, { concepts, questions, reviewPeriodMonths: settings.reviewPeriodMonths, now });
	for (const f of findings) {
		const kind = GATE_KIND[f.gateId];
		if (kind) items.push({ kind, elementIri: f.elementIri, label: labelOf(f.elementIri), detail: f.message, href: gateFindingLink(f, schema) });
	}

	const liveConcepts = concepts.filter((c) => LIVE.includes(c.status));
	for (const c of liveConcepts) {
		const link = appUrl(`/vocabulary?concept=${encodeURIComponent(c.iri)}`);
		if (!c.authority.trim()) {
			items.push({ kind: 'unowned-concept', elementIri: c.iri, label: conceptTitle(c), detail: `"${conceptTitle(c)}" names no authority.`, href: link });
		}
		const age = monthsAgo(c.modified || c.created, now);
		if (age !== null && age >= settings.staleAfterMonths) {
			items.push({
				kind: 'stale-concept',
				elementIri: c.iri,
				label: conceptTitle(c),
				detail: `"${conceptTitle(c)}" has not been touched for ${age} months (threshold ${settings.staleAfterMonths}).`,
				href: link
			});
		}
	}

	for (const h of schemeHealthDebt(analyseSchemeHealth(concepts), labelOf)) {
		items.push({
			kind: h.kind,
			elementIri: h.concept,
			label: labelOf(h.concept),
			detail: h.detail,
			href: appUrl(`/vocabulary?concept=${encodeURIComponent(h.concept)}`)
		});
	}

	const linked = new Set(questions.flatMap((q) => q.linkedElements));
	for (const c of modelClasses(schema)) {
		if (linked.has(c.iri)) continue;
		items.push({
			kind: 'class-without-question',
			elementIri: c.iri,
			label: c.label,
			detail: `Class "${c.label}" is not needed by any competency question.`,
			href: appUrl(`/?focus=${encodeURIComponent(c.iri)}`)
		});
	}

	const outcome = new Map(latestOutcomes(runs).map((r) => [r.questionIri, r.outcome]));
	for (const q of questions) {
		const latest = outcome.get(q.iri);
		if (latest === 'fail' || latest === 'error') {
			items.push({
				kind: 'failing-question',
				elementIri: q.iri,
				label: q.question,
				detail: `The competency question "${q.question}" ${latest === 'fail' ? 'fails' : 'errors'} in its latest run.`,
				href: appUrl('/questions')
			});
		}
	}
	return items;
}

export const countDebt = (items: DebtItem[]) => items.length;

export interface DebtFilter {
	kind?: DebtKind;
	search?: string;
}

export function filterDebt(items: DebtItem[], filter: DebtFilter): DebtItem[] {
	const wanted = (filter.search ?? '').trim().toLowerCase();
	return items.filter((i) => {
		if (filter.kind && i.kind !== filter.kind) return false;
		return !wanted || `${i.label} ${i.detail}`.toLowerCase().includes(wanted);
	});
}
