/**
 * SKOS concepts of the core vocabulary (ontology-pipeline STORY-322): types, the status lifecycle,
 * validation and the duplicate/variant check at entry. Pure; storage is in `SparqlConnector`.
 */

import { isWellFormedIri } from '#lib/utils/iri.js';
import type { SchemeMetadata } from './scheme-metadata';

export const CONCEPT_STATUSES = ['proposed', 'approved', 'active', 'deprecated', 'retired'] as const;
export type ConceptStatus = (typeof CONCEPT_STATUSES)[number];

/** Mapping properties to concepts of other schemes (STORY-329). */
export const MAPPING_KINDS = ['exactMatch', 'closeMatch', 'relatedMatch', 'broadMatch', 'narrowMatch'] as const;
export type MappingKind = (typeof MAPPING_KINDS)[number];
/** `related` is the associative relation inside a vocabulary; the rest are mappings. */
export type RelationKind = 'related' | MappingKind;

export interface ConceptMapping {
	kind: MappingKind;
	target: string;
}

export interface LangText {
	text: string;
	/** BCP 47 tag; empty for a plain literal. */
	lang: string;
}

export interface ConceptDraft {
	prefLabels: LangText[];
	altLabels: LangText[];
	hiddenLabels: LangText[];
	/** `skos:definition`, one per language. */
	definitions: LangText[];
	/** `skos:scopeNote`, one per language. */
	scopeNotes: LangText[];
	/** Legacy or system codes (`skos:notation`); zero or more, plain literals. */
	notation?: string[];
	/** `skos:example`: how the term is used; zero or more. */
	example?: string[];
	/** `skos:editorialNote`: internal working notes, never shown on read-only pages or in the default export. */
	editorialNote?: string[];
	/** Qualifier for homonyms ("finance" for Bank); the preferred label stays free of parentheses. */
	disambiguation: string;
	/** Empty when the concept belongs to no scheme yet. */
	schemeIri: string;
	topConcept: boolean;
	status: ConceptStatus;
	source: string;
	/** Name of the group holding authority: the label of the linked business unit, or an old plain-text value. */
	authority: string;
	/** The business unit node `authority` names; absent for an old plain-text value. */
	authorityIri?: string;
	/** Save only: `authority` is a new name, so the store links the unit of that name or creates it. */
	authorityCreate?: boolean;
	replacedBy: string;
	deprecationReason: string;
}

/** Why a scheme exists and where it stops, written down before terms are collected (book p. 22). */
export interface SchemeScope {
	purpose: string;
	decisionsSupported: string;
	outOfScope: string;
	stakeholders: string;
}

export interface ConceptScheme {
	iri: string;
	name: string;
	description: string;
	scope: SchemeScope;
	/** Dublin Core description; absent on a scheme loaded without it. */
	metadata?: SchemeMetadata;
}

/** A scheme's readable name: its label, else its Dublin Core title, else the local name of its IRI (after `#`
 *  or the last `/`). The stored label is never rewritten; this is for display only. */
export function schemeDisplayName(scheme: Pick<ConceptScheme, 'iri' | 'name' | 'metadata'>): string {
	const name = scheme.name?.trim();
	if (name) return name;
	const title = scheme.metadata?.title?.trim();
	if (title) return title;
	return scheme.iri.replace(/[#/]+$/, '').split(/[#/]/).pop() || scheme.iri;
}

export interface Concept extends ConceptDraft {
	iri: string;
	/** `YYYY-MM-DD` or empty. */
	created: string;
	modified: string;
	deprecatedOn: string;
	/** IRIs of the `skos:broader` concepts (STORY-328); absent means none. */
	broader?: string[];
	/** IRIs of the `skos:related` concepts this concept states (the inverse is stated on the other concept). */
	related?: string[];
	mappings?: ConceptMapping[];
}

/** The lifecycle moves one step forward; nothing goes back and retired is final. */
export function nextStatuses(status: ConceptStatus): ConceptStatus[] {
	const i = CONCEPT_STATUSES.indexOf(status);
	return i >= 0 && i < CONCEPT_STATUSES.length - 1 ? [CONCEPT_STATUSES[i + 1]] : [];
}

export function canTransition(from: ConceptStatus, to: ConceptStatus): boolean {
	return nextStatuses(from).includes(to);
}

/** `null` when the change is allowed, else the reason it is not. */
export function validateStatusChange(
	from: ConceptStatus,
	to: ConceptStatus,
	extra: { reason?: string; replacedBy?: string }
): string | null {
	if (!canTransition(from, to)) return `A concept cannot go from ${from} to ${to}`;
	if (to === 'deprecated') {
		if (!extra.reason?.trim()) return 'Deprecating a concept needs a reason';
		const replacement = extra.replacedBy?.trim();
		if (replacement && !isWellFormedIri(replacement)) return 'The replacement must be a well-formed IRI';
	}
	return null;
}

/** Lower case, accents removed, punctuation dropped, whitespace collapsed. */
export function normaliseLabel(label: string): string {
	return label
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

const hasText = (v: LangText) => v.text.trim() !== '';

/** Same shape the Go glossary accepts (`backend/internal/glossary`): a BCP 47-like tag. */
const LANG_TAG = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;

/** Whether `tag` is usable as a language tag; the empty string means "no language" and is allowed. */
export function isValidLangTag(tag: string): boolean {
	return tag === '' || LANG_TAG.test(tag);
}

/** Tags offered in the language pickers' datalist; any valid tag may still be typed. */
export const COMMON_LANG_TAGS = ['en', 'de', 'fr', 'it', 'es', 'nl', 'pt', 'sv', 'da', 'pl', 'ja', 'zh'] as const;

const sameLang = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The trimmed text in `lang` (case-insensitive), or '' when there is none. */
export function textIn(values: LangText[], lang: string): string {
	return values.find((v) => hasText(v) && sameLang(v.lang, lang))?.text.trim() ?? '';
}

/** One string out of per-language values: the preferred language if present, else the first non-empty text.
 *  Every consumer that needs a single definition or note goes through this. */
export function primaryText(values: LangText[], preferredLang?: string): string {
	if (preferredLang !== undefined) {
		const preferred = textIn(values, preferredLang);
		if (preferred) return preferred;
	}
	return values.find(hasText)?.text.trim() ?? '';
}

/** Each non-empty text as `text (lang)`, bare when untagged; for views that show every language. */
export function taggedTexts(values: LangText[]): string[] {
	return values.filter(hasText).map((v) => (v.lang.trim() ? `${v.text.trim()} (${v.lang.trim()})` : v.text.trim()));
}

/** Sorted, lower-cased tags used by any non-empty label, definition or scope note. */
export function languagesOf(c: Pick<ConceptDraft, 'prefLabels' | 'altLabels' | 'hiddenLabels' | 'definitions' | 'scopeNotes'>): string[] {
	const tags = [...c.prefLabels, ...c.altLabels, ...c.hiddenLabels, ...c.definitions, ...c.scopeNotes]
		.filter(hasText)
		.map((v) => v.lang.trim().toLowerCase());
	return [...new Set(tags)].sort();
}

export function validateConceptDraft(d: ConceptDraft): string[] {
	const errors: string[] = [];
	const add = (msg: string) => {
		if (!errors.includes(msg)) errors.push(msg);
	};
	const prefs = d.prefLabels.filter(hasText);
	if (prefs.length === 0) errors.push('A preferred label is required');
	for (const v of [...d.prefLabels, ...d.altLabels, ...d.hiddenLabels, ...d.definitions, ...d.scopeNotes].filter(hasText)) {
		if (!isValidLangTag(v.lang.trim())) add(`Invalid language tag "${v.lang.trim()}"`);
	}
	const seen = new Set<string>();
	for (const p of prefs) {
		const lang = p.lang.trim().toLowerCase();
		if (seen.has(lang)) add(`Only one preferred label per language (${lang || 'none'})`);
		seen.add(lang);
		if (/[()]/.test(p.text)) add('Preferred label must not contain parentheses; use the disambiguation field');
	}
	for (const [values, noun] of [[d.definitions, 'definition'], [d.scopeNotes, 'scope note']] as const) {
		const langs = new Set<string>();
		for (const v of values.filter(hasText)) {
			const lang = v.lang.trim().toLowerCase();
			if (langs.has(lang)) add(`Only one ${noun} per language (${lang || 'none'})`);
			langs.add(lang);
		}
	}
	for (const a of d.altLabels.filter(hasText)) {
		const repeats = prefs.some((p) => sameLang(p.lang, a.lang) && normaliseLabel(p.text) === normaliseLabel(a.text));
		if (repeats) errors.push(`Alternative label "${a.text.trim()}" repeats the preferred label`);
	}
	if (d.status !== 'proposed' && !d.definitions.some(hasText)) errors.push('A definition is required before a concept is approved');
	if (d.topConcept && !d.schemeIri.trim()) errors.push('A top concept needs a scheme');
	return errors;
}

export interface SimilarConcept {
	iri: string;
	match: 'equal' | 'similar';
	via: 'preferred' | 'alternative';
	/** The stored label that matched. */
	label: string;
}

interface LabelledConcept {
	iri: string;
	prefLabels: LangText[];
	altLabels: LangText[];
}

function editDistance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let diagonal = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const above = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
			diagonal = above;
		}
	}
	return row[b.length];
}

const sortedWords = (s: string) => s.split(' ').sort().join(' ');
const singular = (s: string) => s.split(' ').map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');

function isSimilar(a: string, b: string): boolean {
	if (sortedWords(a) === sortedWords(b)) return true;
	if (sortedWords(singular(a)) === sortedWords(singular(b))) return true;
	const longest = Math.max(a.length, b.length);
	if (longest < 5) return false;
	return editDistance(a, b) <= (longest >= 9 ? 2 : 1);
}

/** Existing concepts whose preferred or alternative label equals or nearly equals `label`, equal
 *  matches first. A hit should suggest "add as alternative label" instead of a new concept. */
export function findSimilarConcepts(
	label: string,
	concepts: LabelledConcept[],
	options: { ignoreIri?: string } = {}
): SimilarConcept[] {
	const wanted = normaliseLabel(label);
	if (!wanted) return [];
	const found: SimilarConcept[] = [];
	for (const c of concepts) {
		if (c.iri === options.ignoreIri) continue;
		const candidates: { via: SimilarConcept['via']; text: string }[] = [
			...c.prefLabels.map((l) => ({ via: 'preferred' as const, text: l.text })),
			...c.altLabels.map((l) => ({ via: 'alternative' as const, text: l.text }))
		];
		let best: SimilarConcept | null = null;
		for (const cand of candidates) {
			const norm = normaliseLabel(cand.text);
			if (!norm) continue;
			const match = norm === wanted ? 'equal' : isSimilar(norm, wanted) ? 'similar' : null;
			if (!match) continue;
			if (!best || (match === 'equal' && best.match === 'similar')) {
				best = { iri: c.iri, match, via: cand.via, label: cand.text };
			}
		}
		if (best) found.push(best);
	}
	return [...found.filter((m) => m.match === 'equal'), ...found.filter((m) => m.match === 'similar')];
}

/** The preferred label with its homonym qualifier, e.g. "Bank (finance)". */
export function conceptTitle(c: Pick<Concept, 'prefLabels' | 'disambiguation'>): string {
	const label = c.prefLabels.find((l) => l.text.trim())?.text.trim();
	if (!label) return '(no label)';
	return c.disambiguation.trim() ? `${label} (${c.disambiguation.trim()})` : label;
}

export interface ConceptFilter {
	search?: string;
	status?: ConceptStatus;
	schemeIri?: string;
}

/** Search matches any label or the definition, ignoring case and accents. */
export function filterConcepts(concepts: Concept[], filter: ConceptFilter): Concept[] {
	const wanted = normaliseLabel(filter.search ?? '');
	return concepts.filter((c) => {
		if (filter.status && c.status !== filter.status) return false;
		if (filter.schemeIri && c.schemeIri !== filter.schemeIri) return false;
		if (!wanted) return true;
		const haystack = [...c.prefLabels, ...c.altLabels, ...c.hiddenLabels]
			.map((l) => l.text)
			.concat(c.definitions.map((d) => d.text), c.notation ?? []);
		return haystack.some((text) => normaliseLabel(text).includes(wanted));
	});
}

/** Adds `text` as an alternative label unless the concept already carries it in any label role. */
export function addAlternativeLabel(c: ConceptDraft, text: string, lang: string): ConceptDraft {
	const norm = normaliseLabel(text);
	if (!norm) return c;
	const known = [...c.prefLabels, ...c.altLabels, ...c.hiddenLabels].some((l) => normaliseLabel(l.text) === norm);
	return known ? c : { ...c, altLabels: [...c.altLabels, { text: text.trim(), lang }] };
}

/** The replacement with the deprecated concept's preferred labels added as hidden labels, so a search
 *  for the old term still finds it (book pp. 51, 135); `null` when there is nothing to add. */
export function moveLabelToReplacement(old: Concept, replacement: Concept): ConceptDraft | null {
	let next: ConceptDraft = replacement;
	for (const label of old.prefLabels.filter(hasText)) {
		const known = [...next.prefLabels, ...next.altLabels, ...next.hiddenLabels].some(
			(l) => normaliseLabel(l.text) === normaliseLabel(label.text)
		);
		if (!known) next = { ...next, hiddenLabels: [...next.hiddenLabels, { text: label.text.trim(), lang: label.lang }] };
	}
	return next === replacement ? null : next;
}
