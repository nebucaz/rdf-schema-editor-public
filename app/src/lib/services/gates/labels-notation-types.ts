/**
 * Label, language, notation and type gates (skos-support STORY-421; W3C SKOS S9, S37). They run over the vocabulary's concepts from
 * `GateOptions.concepts` and stay silent without them. Gates about notation and collection members are conventions of this app,
 * not W3C rules, and say so.
 */
import { conceptTitle, type Concept, type LangText } from '../skos-concept';
import type { Gate, GateFinding, GateSeverity } from './types';

const finding = (gateId: string, severity: GateSeverity, iri: string, message: string): GateFinding => ({
	gateId,
	stage: 'vocabulary',
	severity,
	elementIri: iri,
	message
});

/** Well-formed BCP 47 (RFC 5646) tag: language, extlang, script, region, variants, extensions and private use; or a private-use-only tag. */
const BCP47 =
	/^(?:[a-z]{2,3}(?:-[a-z]{3}){0,3}|[a-z]{4}|[a-z]{5,8})(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*(?:-[a-wy-z0-9](?:-[a-z0-9]{2,8})+)*(?:-x(?:-[a-z0-9]{1,8})+)?$|^x(?:-[a-z0-9]{1,8})+$/i;
export const isWellFormedLanguageTag = (tag: string): boolean => BCP47.test(tag);

const allLabels = (c: Concept): LangText[] => [...c.prefLabels, ...c.altLabels, ...c.hiddenLabels];
const allTexts = (c: Concept): LangText[] => [...c.prefLabels, ...c.altLabels, ...c.hiddenLabels, ...c.definitions, ...c.scopeNotes];

export const invalidLanguageTagGate: Gate = {
	id: 'invalid-language-tag',
	stage: 'vocabulary',
	run: (_schema, options) =>
		(options.concepts ?? []).flatMap((c) => {
			const bad = [...new Set(allTexts(c).filter((l) => l.text.trim()).map((l) => l.lang).filter((t) => t !== '' && !isWellFormedLanguageTag(t)))];
			return bad.length
				? [finding('invalid-language-tag', 'warning', c.iri, `"${conceptTitle(c)}" has a text with a language tag that is not well-formed BCP 47: ${bad.map((t) => `"${t}"`).join(', ')}.`)]
				: [];
		})
};

/** Per concept: within a scheme that uses two or more languages for preferred labels, the languages in which
 *  the concept lacks a preferred label or a definition. */
export const incompleteLanguageCoverageGate: Gate = {
	id: 'incomplete-language-coverage',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const byScheme = new Map<string, Concept[]>();
		for (const c of options.concepts ?? []) if (c.schemeIri) byScheme.set(c.schemeIri, [...(byScheme.get(c.schemeIri) ?? []), c]);
		const tags = (values: LangText[]) => new Set(values.filter((l) => l.text.trim() && l.lang.trim()).map((l) => l.lang.trim().toLowerCase()));
		return [...byScheme.values()].flatMap((cs) => {
			const set = [...new Set(cs.flatMap((c) => [...tags(c.prefLabels)]))].sort();
			if (set.length < 2) return [];
			return cs.flatMap((c) => {
				const prefs = tags(c.prefLabels);
				const defs = tags(c.definitions);
				const gaps = set.flatMap((lang) => {
					const missing = [...(prefs.has(lang) ? [] : ['preferred label']), ...(defs.has(lang) ? [] : ['definition'])];
					return missing.length ? [`${lang}: ${missing.join(' and ')}`] : [];
				});
				return gaps.length ? [finding('incomplete-language-coverage', 'info', c.iri, `"${conceptTitle(c)}" is missing text in a language its scheme uses (${gaps.join('; ')}).`)] : [];
			});
		});
	}
};

export const emptyOrUnprintableLabelGate: Gate = {
	id: 'empty-or-unprintable-label',
	stage: 'vocabulary',
	run: (_schema, options) =>
		(options.concepts ?? []).flatMap((c) =>
			allLabels(c).some((l) => !l.text.trim() || /[\p{Cc}\p{Cf}]/u.test(l.text))
				? [finding('empty-or-unprintable-label', 'warning', c.iri, `"${conceptTitle(c)}" has an empty, whitespace-only or control-character label.`)]
				: []
		)
};

export const duplicateNotationGate: Gate = {
	id: 'duplicate-notation',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const seen = new Map<string, Concept[]>();
		for (const c of options.concepts ?? [])
			for (const n of new Set((c.notation ?? []).map((x) => x.trim()).filter(Boolean)))
				seen.set(`${c.schemeIri}\n${n}`, [...(seen.get(`${c.schemeIri}\n${n}`) ?? []), c]);
		return [...seen].flatMap(([key, cs]) =>
			cs.length > 1
				? [finding('duplicate-notation', 'info', cs[0].iri, `The notation "${key.split('\n')[1]}" is used by ${cs.map((c) => `"${conceptTitle(c)}"`).join(', ')} in one scheme. Unique notation is a convention of this app, not a W3C rule.`)]
				: []
		);
	}
};

export const typeDisjointnessGate: Gate = {
	id: 'type-disjointness',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const concepts = options.concepts ?? [];
		if (!concepts.length && !options.collections?.length) return [];
		const conceptIris = new Set(concepts.map((c) => c.iri));
		const schemeIris = new Set([...(options.schemes ?? []).map((s) => s.iri), ...concepts.map((c) => c.schemeIri).filter(Boolean)]);
		const out: GateFinding[] = [];
		for (const iri of conceptIris)
			if (schemeIris.has(iri)) out.push(finding('type-disjointness', 'warning', iri, `${iri} is both a Concept and a ConceptScheme. SKOS declares the two disjoint (S9).`));
		for (const c of options.collections ?? []) {
			if (conceptIris.has(c.iri)) out.push(finding('type-disjointness', 'warning', c.iri, `${c.iri} is both a Collection and a Concept. SKOS declares them disjoint (S37).`));
			if (schemeIris.has(c.iri)) out.push(finding('type-disjointness', 'warning', c.iri, `${c.iri} is both a Collection and a ConceptScheme. SKOS declares them disjoint (S37).`));
		}
		return out;
	}
};

export const collectionMemberInvalidGate: Gate = {
	id: 'collection-member-invalid',
	stage: 'vocabulary',
	run: (_schema, options) => {
		const known = new Set([...(options.concepts ?? []).map((c) => c.iri), ...(options.collections ?? []).map((c) => c.iri)]);
		return (options.concepts ? (options.collections ?? []) : []).flatMap((coll) => {
			const bad = coll.members.filter((m) => !known.has(m));
			return bad.length
				? [finding('collection-member-invalid', 'warning', coll.iri, `A collection has members that are neither a concept nor a collection of the vocabulary: ${bad.join(', ')}. Collections holding only vocabulary concepts or collections is a convention of this app, not a W3C rule.`)]
				: [];
		});
	}
};

export const LABELS_NOTATION_TYPES_GATES: Gate[] = [
	invalidLanguageTagGate,
	incompleteLanguageCoverageGate,
	emptyOrUnprintableLabelGate,
	duplicateNotationGate,
	typeDisjointnessGate,
	collectionMemberInvalidGate
];
