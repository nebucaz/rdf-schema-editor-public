/**
 * Gates for the controlled vocabulary (ontology-pipeline STORY-324; book pp. 28, 50-51, 107). They run over
 * the concepts handed in through `GateOptions.concepts`, so a whole vocabulary needs one query and no
 * per-concept request. Concepts being phased out (deprecated, retired) are left out. All findings are
 * warnings except the four-word label, which is only a prompt to review.
 */
import { conceptTitle, normaliseLabel, type Concept, type LangText } from '../skos-concept';
import type { Gate, GateFinding, GateSeverity } from './types';

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];
const live = (concepts: Concept[] | undefined) => (concepts ?? []).filter((c) => LIVE.includes(c.status));

const finding = (gateId: string, severity: GateSeverity, c: Concept, message: string): GateFinding => ({
	gateId,
	stage: 'vocabulary',
	severity,
	elementIri: c.iri,
	message
});

export type LabelIssueKind = 'long' | 'punctuation' | 'markup' | 'capitalisation';

export interface LabelIssue {
	kind: LabelIssueKind;
	detail: string;
}

const MAX_WORDS = 4;
const SMALL_WORDS = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
const MARKUP = [/<\/?[a-z][^>]*>/i, /\*\*|__/, /`/, /\[[^\]]*\]\([^)]*\)/, /^_[^_]+_$/];

const wordsOf = (label: string) => label.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
const isAcronymWord = (w: string) => /^[\p{Lu}\p{N}]{2,}$/u.test(w);

function capitalisationIsOdd(label: string): boolean {
	const words = wordsOf(label).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
	if (words.some((w) => /\p{Ll}\p{Lu}/u.test(w))) return true;
	const significant = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && !isAcronymWord(w) && /\p{L}/u.test(w));
	if (significant.length < 2) return false;
	const capitalised = significant.map((w) => /^\p{Lu}/u.test(w));
	if (capitalised.every(Boolean) || capitalised.every((c) => !c)) return false;
	// Sentence case: only the very first word of the label is capitalised.
	const first = words.find((w) => !isAcronymWord(w));
	return !(capitalised[0] && capitalised.slice(1).every((c) => !c) && significant[0] === first);
}

/** The style problems of one label; the empty list means it is fine. */
export function lintLabel(label: string): LabelIssue[] {
	const issues: LabelIssue[] = [];
	const words = wordsOf(label);
	if (words.length > MAX_WORDS) issues.push({ kind: 'long', detail: `${words.length} words` });
	if (/[:;()?!]/.test(label)) issues.push({ kind: 'punctuation', detail: 'contains one of : ; ( ) ? !' });
	if (MARKUP.some((m) => m.test(label.trim()))) issues.push({ kind: 'markup', detail: 'contains markup' });
	if (capitalisationIsOdd(label)) issues.push({ kind: 'capitalisation', detail: 'odd capitalisation' });
	return issues;
}

const styledLabels = (c: Concept): LangText[] => [...c.prefLabels, ...c.altLabels].filter((l) => l.text.trim());

function lintGate(gateId: string, kind: LabelIssueKind, severity: GateSeverity, describe: (label: string, detail: string) => string): Gate {
	return {
		id: gateId,
		stage: 'vocabulary',
		run: (_schema, options) =>
			live(options.concepts).flatMap((c) => {
				const hit = styledLabels(c)
					.map((l) => ({ label: l.text.trim(), issue: lintLabel(l.text).find((i) => i.kind === kind) }))
					.find((x) => x.issue);
				return hit ? [finding(gateId, severity, c, describe(hit.label, hit.issue!.detail))] : [];
			})
	};
}

const prefKey = (c: Concept, l: LangText) =>
	`${l.lang.trim().toLowerCase()}|${normaliseLabel(l.text)}|${normaliseLabel(c.disambiguation)}`;

export const conceptWithoutDefinitionGate: Gate = {
	id: 'concept-without-definition',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => !c.definition.trim())
			.map((c) => finding('concept-without-definition', 'warning', c, `Concept "${conceptTitle(c)}" has no definition.`))
};

export const duplicatePreferredLabelGate: Gate = {
	id: 'duplicate-preferred-label',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const concepts = live(options.concepts);
		const owners = new Map<string, Set<string>>();
		for (const c of concepts) {
			for (const l of c.prefLabels.filter((x) => x.text.trim())) {
				const key = prefKey(c, l);
				owners.set(key, (owners.get(key) ?? new Set()).add(c.iri));
			}
		}
		return concepts
			.filter((c) => c.prefLabels.some((l) => l.text.trim() && (owners.get(prefKey(c, l))?.size ?? 0) > 1))
			.map((c) =>
				finding(
					'duplicate-preferred-label',
					'warning',
					c,
					`Another concept has the preferred label "${conceptTitle(c)}". Reuse it, or add a disambiguation if the meaning differs.`
				)
			);
	}
};

export const altLabelEqualsOtherPreferredGate: Gate = {
	id: 'alt-label-equals-other-preferred-label',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const concepts = live(options.concepts);
		const preferredBy = new Map<string, Set<string>>();
		for (const c of concepts) {
			for (const l of c.prefLabels) preferredBy.set(normaliseLabel(l.text), (preferredBy.get(normaliseLabel(l.text)) ?? new Set()).add(c.iri));
		}
		return concepts.flatMap((c) => {
			const clash = c.altLabels.find((l) => [...(preferredBy.get(normaliseLabel(l.text)) ?? [])].some((iri) => iri !== c.iri));
			return clash
				? [finding('alt-label-equals-other-preferred-label', 'warning', c, `Alternative label "${clash.text.trim()}" of "${conceptTitle(c)}" is the preferred label of another concept.`)]
				: [];
		});
	}
};

export const labelTooLongGate = lintGate('label-too-long', 'long', 'info', (label, detail) => `Label "${label}" has ${detail}; review whether a shorter term exists.`);
export const labelPunctuationGate = lintGate('label-punctuation', 'punctuation', 'warning', (label) => `Label "${label}" contains punctuation (: ; ( ) ? !). Move the qualifier to the disambiguation or scope note.`);
export const labelMarkupGate = lintGate('label-markup', 'markup', 'warning', (label) => `Label "${label}" contains markup.`);
export const labelCapitalisationGate = lintGate('label-capitalisation', 'capitalisation', 'warning', (label) => `Label "${label}" has odd capitalisation.`);

export const acronymAsPreferredLabelGate: Gate = {
	id: 'acronym-as-preferred-label',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => c.prefLabels.some((l) => /^[\p{Lu}\p{N}]{2,6}$/u.test(l.text.trim()) && /\p{Lu}{2}/u.test(l.text.trim())))
			.map((c) =>
				finding('acronym-as-preferred-label', 'warning', c, `Preferred label "${conceptTitle(c)}" is an acronym. Use the full term and keep the acronym as an alternative label.`)
			)
};

export const conceptWithoutProvenanceGate: Gate = {
	id: 'concept-without-provenance',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => !c.source.trim() || !c.authority.trim())
			.map((c) => finding('concept-without-provenance', 'warning', c, `Concept "${conceptTitle(c)}" has no source or authority.`))
};

export const multiplePreferredLabelsGate: Gate = {
	id: 'multiple-preferred-labels-per-language',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => {
				const langs = c.prefLabels.filter((l) => l.text.trim()).map((l) => l.lang.trim().toLowerCase());
				return new Set(langs).size < langs.length;
			})
			.map((c) => finding('multiple-preferred-labels-per-language', 'warning', c, `Concept "${conceptTitle(c)}" has more than one preferred label in a language.`))
};

export const labelRolesOverlapGate: Gate = {
	id: 'label-roles-overlap',
	stage: 'vocabulary',
	run: (_schema, options) =>
		live(options.concepts)
			.filter((c) => overlaps([c.prefLabels, c.altLabels, c.hiddenLabels].map((ls) => new Set(ls.map((l) => normaliseLabel(l.text)).filter(Boolean)))))
			.map((c) => finding('label-roles-overlap', 'warning', c, `Concept "${conceptTitle(c)}" uses the same label as preferred, alternative or hidden label.`))
};

function overlaps(roles: Set<string>[]): boolean {
	const count = new Map<string, number>();
	for (const role of roles) for (const label of role) count.set(label, (count.get(label) ?? 0) + 1);
	return [...count.values()].some((n) => n > 1);
}

export const VOCABULARY_GATES: Gate[] = [
	conceptWithoutDefinitionGate,
	duplicatePreferredLabelGate,
	altLabelEqualsOtherPreferredGate,
	labelTooLongGate,
	labelPunctuationGate,
	labelMarkupGate,
	labelCapitalisationGate,
	acronymAsPreferredLabelGate,
	conceptWithoutProvenanceGate,
	multiplePreferredLabelsGate,
	labelRolesOverlapGate
];

/** The vocabulary gates over a concept list. They never read the schema, so none is needed. */
export function runVocabularyGates(concepts: Concept[]): GateFinding[] {
	return VOCABULARY_GATES.flatMap((gate) => gate.run(undefined as never, { concepts }));
}
