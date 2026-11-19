/**
 * Merging a duplicate concept into a survivor (skos-support STORY-423). Pure: builds a `MergePlan` that lists
 * everything that moves, what needs a decision and what was dropped; the connector applies it in one update.
 * IRIs never change: the duplicate stays as a retired tombstone that points to the survivor.
 */
import { conceptTitle, type Concept, type ConceptDraft, type ConceptMapping, type LangText, type MappingKind } from './skos-concept';
import { relationsOf } from './concept-relations';
import type { SkosCollection } from './skos-collection';

export interface MergeDecisions {
	/** Which definition the survivor keeps when both have one and they differ; default is the survivor's. */
	definition?: 'survivor' | 'duplicate';
	/** Keep both sets of notations, or only the survivor's. */
	notation?: 'survivor' | 'both';
}

export interface MergeInput {
	/** Every concept of the vocabulary (deprecated ones too: they can point at the duplicate). */
	concepts: Concept[];
	collections: SkosCollection[];
	/** Classes whose `rse:definedByConcept` is the duplicate. */
	classLinks: { classIri: string; label: string }[];
	survivor: string;
	duplicate: string;
	decisions?: MergeDecisions;
}

export interface MergeConflict {
	field: 'definition' | 'notation';
	survivor: string;
	duplicate: string;
	resolved: boolean;
}

/** `keep: false` means the old link is only removed: the new one would be a cycle, a self link or a repeat. */
export interface Retarget {
	concept: string;
	keep: boolean;
}

export interface MergePlan {
	survivor: string;
	duplicate: string;
	/** Why the merge cannot be done at all; the rest of the plan is then empty. */
	error: string | null;
	conflicts: MergeConflict[];
	survivorDraft: ConceptDraft;
	addBroader: string[];
	addRelated: string[];
	addMappings: ConceptMapping[];
	/** Concepts whose `skos:broader` is the duplicate. */
	incomingBroader: Retarget[];
	/** Concepts that state `skos:related` to the duplicate (the link is re-stated on the survivor). */
	incomingRelated: string[];
	incomingMappings: (Retarget & { kind: MappingKind })[];
	/** Concepts whose `rse:replacedBy` is the duplicate. */
	incomingReplacedBy: Retarget[];
	/** Collections that hold the duplicate, with their members after the merge. */
	collections: { iri: string; ordered: boolean; members: string[] }[];
	classLinks: { classIri: string; label: string }[];
	/** Human text for what was left out, and why. */
	dropped: string[];
	warnings: string[];
	/** Human text for everything that moves, for the preview. */
	moves: string[];
}

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];
const sorted = (xs: Iterable<string>) => [...xs].sort();
const labelKey = (l: LangText) => `${l.lang.toLowerCase()}|${l.text.trim().toLowerCase()}`;

function emptyPlan(input: MergeInput, error: string, draft?: ConceptDraft): MergePlan {
	return {
		survivor: input.survivor, duplicate: input.duplicate, error, conflicts: [],
		survivorDraft: draft ?? ({} as ConceptDraft), addBroader: [], addRelated: [], addMappings: [],
		incomingBroader: [], incomingRelated: [], incomingMappings: [], incomingReplacedBy: [],
		collections: [], classLinks: [], dropped: [], warnings: [], moves: []
	};
}

export function planMerge(input: MergeInput): MergePlan {
	const { concepts, survivor: sIri, duplicate: dIri } = input;
	if (sIri === dIri) return emptyPlan(input, 'A concept cannot be merged into itself');
	const s = concepts.find((c) => c.iri === sIri);
	const d = concepts.find((c) => c.iri === dIri);
	if (!s || !d) return emptyPlan(input, 'Concept not found');
	if (!LIVE.includes(s.status)) return emptyPlan(input, 'The surviving concept is deprecated or retired');
	if (d.status === 'retired') return emptyPlan(input, 'The duplicate is already retired');

	const title = (iri: string) => {
		const found = concepts.find((c) => c.iri === iri);
		return found ? conceptTitle(found) : iri;
	};
	const decisions = input.decisions ?? {};
	const dropped: string[] = [];
	const warnings: string[] = [];
	const moves: string[] = [];
	const conflicts: MergeConflict[] = [];

	// -- Labels --------------------------------------------------------------------------------------
	const pref = [...s.prefLabels];
	const prefLangs = new Set(pref.map((l) => l.lang.toLowerCase()));
	const alt = [...s.altLabels];
	const hidden = [...s.hiddenLabels];
	const taken = new Set([...pref, ...alt, ...hidden].map(labelKey));
	const take = (l: LangText, into: LangText[], what: string) => {
		if (!l.text.trim() || taken.has(labelKey(l))) return;
		taken.add(labelKey(l));
		into.push(l);
		moves.push(`${what} "${l.text}"${l.lang ? ` (${l.lang})` : ''}`);
	};
	for (const l of d.prefLabels) {
		if (!prefLangs.has(l.lang.toLowerCase())) {
			prefLangs.add(l.lang.toLowerCase());
			take(l, pref, 'Preferred label');
		} else take(l, alt, 'Alternative label (was preferred)');
	}
	for (const l of d.altLabels) take(l, alt, 'Alternative label');
	for (const l of d.hiddenLabels) take(l, hidden, 'Hidden label');

	// -- Text fields -----------------------------------------------------------------------------------
	let definition = s.definition;
	if (!s.definition.trim()) {
		definition = d.definition;
		if (d.definition.trim()) moves.push('Definition');
	} else if (d.definition.trim() && d.definition.trim() !== s.definition.trim()) {
		const choice = decisions.definition;
		conflicts.push({ field: 'definition', survivor: s.definition, duplicate: d.definition, resolved: choice !== undefined });
		if (choice === 'duplicate') definition = d.definition;
	}
	let notation = [...(s.notation ?? [])];
	const dn = d.notation ?? [];
	if (notation.length === 0) {
		notation = [...dn];
		if (dn.length) moves.push(`Notation ${dn.join(', ')}`);
	} else if (dn.some((n) => !notation.includes(n))) {
		const choice = decisions.notation;
		conflicts.push({ field: 'notation', survivor: notation.join(', '), duplicate: dn.join(', '), resolved: choice !== undefined });
		if (choice === 'both') {
			for (const n of dn) if (!notation.includes(n)) notation.push(n);
			moves.push(`Notation ${dn.join(', ')}`);
		}
	}
	const union = (a: string[] | undefined, b: string[] | undefined, what: string) => {
		const out = [...(a ?? [])];
		for (const v of b ?? []) if (!out.includes(v)) (out.push(v), moves.push(`${what} "${v}"`));
		return out;
	};
	const example = union(s.example, d.example, 'Example');
	const editorialNote = union(s.editorialNote, d.editorialNote, 'Editorial note');
	const scopeNote = s.scopeNote.trim() ? s.scopeNote : d.scopeNote;
	if (!s.scopeNote.trim() && d.scopeNote.trim()) moves.push('Scope note');

	// -- Scheme ---------------------------------------------------------------------------------------
	let schemeIri = s.schemeIri;
	let topConcept = s.topConcept;
	if (!s.schemeIri && d.schemeIri) {
		schemeIri = d.schemeIri;
		topConcept = d.topConcept;
		moves.push('Scheme membership');
	} else if (d.schemeIri && d.schemeIri !== s.schemeIri) {
		warnings.push(`The duplicate is in another scheme (${d.schemeIri}); the merged concept stays in ${s.schemeIri} and the duplicate's relations now belong there.`);
	}

	const survivorDraft: ConceptDraft = {
		prefLabels: pref, altLabels: alt, hiddenLabels: hidden, definition, scopeNote, notation, example, editorialNote,
		disambiguation: s.disambiguation, schemeIri, topConcept, status: s.status,
		source: s.source || d.source, authority: s.authority || d.authority, replacedBy: s.replacedBy, deprecationReason: s.deprecationReason
	};

	// -- Hierarchy: edges are tried against a working graph without the duplicate ---------------------------
	const working = new Map(concepts.filter((c) => c.iri !== dIri).map((c) => [c.iri, new Set((c.broader ?? []).filter((p) => p !== dIri))]));
	const ancestors = (start: string) => {
		const seen = new Set<string>();
		const stack = [...(working.get(start) ?? [])];
		while (stack.length) {
			const next = stack.pop()!;
			if (seen.has(next)) continue;
			seen.add(next);
			stack.push(...(working.get(next) ?? []));
		}
		return seen;
	};
	const tryEdge = (child: string, parent: string, text: string): boolean => {
		if (child === parent) return (dropped.push(`${text}: would be a link to itself`), false);
		if (working.get(child)?.has(parent)) return (dropped.push(`${text}: already exists`), false);
		if (ancestors(parent).has(child)) return (dropped.push(`${text}: would make a cycle`), false);
		working.get(child)!.add(parent);
		return true;
	};

	const addBroader: string[] = [];
	for (const p of sorted(d.broader ?? [])) {
		if (tryEdge(sIri, p, `Broader "${title(p)}"`)) {
			addBroader.push(p);
			moves.push(`Broader concept "${title(p)}"`);
		}
	}
	const incomingBroader: Retarget[] = [];
	for (const x of concepts.filter((c) => c.iri !== dIri && (c.broader ?? []).includes(dIri)).sort((a, b) => (a.iri < b.iri ? -1 : 1))) {
		const keep = tryEdge(x.iri, sIri, `Narrower "${title(x.iri)}"`);
		incomingBroader.push({ concept: x.iri, keep });
		if (keep) moves.push(`Narrower concept "${title(x.iri)}"`);
	}

	// -- Related ---------------------------------------------------------------------------------------
	const sRelated = new Set(relationsOf(s, concepts).related);
	const addRelated: string[] = [];
	for (const r of sorted(relationsOf(d, concepts).related)) {
		if (r === sIri) dropped.push(`Related "${title(r)}": would be a link to itself`);
		else if (sRelated.has(r)) dropped.push(`Related "${title(r)}": already exists`);
		else {
			addRelated.push(r);
			moves.push(`Related concept "${title(r)}"`);
		}
	}
	const incomingRelated = sorted(concepts.filter((c) => c.iri !== dIri && (c.related ?? []).includes(dIri)).map((c) => c.iri));

	// -- Mappings and other incoming links ----------------------------------------------------------------
	const have = new Set((s.mappings ?? []).map((m) => `${m.kind} ${m.target}`));
	const addMappings: ConceptMapping[] = [];
	for (const m of d.mappings ?? []) {
		if (m.target === sIri || have.has(`${m.kind} ${m.target}`)) continue;
		have.add(`${m.kind} ${m.target}`);
		addMappings.push(m);
		moves.push(`Mapping ${m.kind} ${m.target}`);
	}
	addMappings.sort((a, b) => (`${a.kind} ${a.target}` < `${b.kind} ${b.target}` ? -1 : 1));
	const incomingMappings: (Retarget & { kind: MappingKind })[] = [];
	for (const x of [...concepts].sort((a, b) => (a.iri < b.iri ? -1 : 1))) {
		if (x.iri === dIri) continue;
		for (const m of x.mappings ?? []) {
			if (m.target !== dIri) continue;
			const exists = (x.mappings ?? []).some((o) => o.kind === m.kind && o.target === sIri);
			incomingMappings.push({ concept: x.iri, kind: m.kind, keep: x.iri !== sIri && !exists });
		}
	}
	const incomingReplacedBy: Retarget[] = concepts
		.filter((x) => x.iri !== dIri && x.replacedBy === dIri)
		.sort((a, b) => (a.iri < b.iri ? -1 : 1))
		.map((x) => ({ concept: x.iri, keep: x.iri !== sIri }));
	if (incomingReplacedBy.length) moves.push(`${incomingReplacedBy.length} replaced-by link(s) now point to the survivor`);

	// -- Collections and classes -----------------------------------------------------------------------
	const collections = input.collections
		.filter((col) => col.members.includes(dIri))
		.sort((a, b) => (a.iri < b.iri ? -1 : 1))
		.map((col) => {
			const members: string[] = [];
			for (const m of col.members) {
				const next = m === dIri ? sIri : m;
				if (!members.includes(next)) members.push(next);
			}
			moves.push(`Membership of collection ${col.prefLabels[0]?.text ?? col.iri}`);
			return { iri: col.iri, ordered: col.ordered, members };
		});
	const classLinks = [...input.classLinks].sort((a, b) => (a.classIri < b.classIri ? -1 : 1));
	for (const k of classLinks) moves.push(`Class "${k.label}" is now defined by the survivor`);

	return {
		survivor: sIri, duplicate: dIri, error: null, conflicts, survivorDraft, addBroader, addRelated, addMappings,
		incomingBroader, incomingRelated, incomingMappings, incomingReplacedBy, collections, classLinks, dropped, warnings, moves
	};
}

/** True while a conflict still needs a decision. */
export const hasUnresolved = (plan: MergePlan) => plan.conflicts.some((c) => !c.resolved);
