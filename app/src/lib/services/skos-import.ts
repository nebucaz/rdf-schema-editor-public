/**
 * SKOS import, part 1 (skos-support STORY-415): read a Turtle file into a neutral `ParsedImport`, and compare it with the
 * loaded vocabulary into an `ImportPlan` (new / changed / unchanged / conflicting, similar, skipped, errors, info).
 * Pure: no connector, no fetch, nothing written. The CSV reader (STORY-416) produces the same `ParsedImport`, and the
 * connector (STORY-417) applies a reviewed plan. Only Turtle is read (no RDF/XML, no JSON-LD). Anything outside the
 * supported SKOS subset is listed under `skipped`, never dropped silently (like the backend's `notChecked`).
 */
import { Parser, type Quad } from 'n3';
import { SKOS, SKOS_NS } from '#lib/utils/iri.js';
import { isSafeSparqlIri } from '#lib/utils/sparql-safe.js';
import { MAPPING_KINDS, findSimilarConcepts, type Concept, type ConceptMapping, type LangText, type MappingKind } from './skos-concept';
import { collectionsFromQuads, type SkosCollection } from './skos-collection';
import type { SkosVocabulary } from './skos-export';

export const DEFAULT_IMPORT_LIMITS = { maxBytes: 5_000_000, maxConcepts: 5000, maxLiteral: 4000 };
export type ImportLimits = typeof DEFAULT_IMPORT_LIMITS;

/** The file cannot be imported at all (not Turtle, unsafe IRI, over a cap). The message is for the user. */
export class ImportRefused extends Error {}

export interface ImportedScheme {
	iri: string;
	name: string;
	description: string;
	title: string;
	creator: string;
	publisher: string;
	rights: string;
}

export interface ImportedConcept {
	iri: string;
	prefLabels: LangText[];
	altLabels: LangText[];
	hiddenLabels: LangText[];
	definition: string;
	scopeNote: string;
	notation: string[];
	example: string[];
	editorialNote: string[];
	schemeIri: string;
	topConcept: boolean;
	broader: string[];
	related: string[];
	mappings: ConceptMapping[];
}

export interface ImportIssue {
	code: string;
	message: string;
	iri?: string;
	/** Spreadsheet row of a CSV import (the header is row 1). */
	row?: number;
}

export interface SkippedGroup {
	predicate: string;
	count: number;
	reason: string;
}

export interface ParsedImport {
	schemes: ImportedScheme[];
	concepts: ImportedConcept[];
	collections: SkosCollection[];
	skipped: SkippedGroup[];
	errors: ImportIssue[];
	info: ImportIssue[];
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first';
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const DCT = 'http://purl.org/dc/terms/';
const SKOSXL_NS = 'http://www.w3.org/2008/05/skos-xl#';

/** SKOS terms the import reads, as `SKOS.<name>` keys; the rest of the `skos:` namespace is unknown to it. */
const KNOWN_SKOS = new Set<string>(Object.values(SKOS));
/** Standard descriptive terms that are generated or belong to the project, listed rather than imported. */
const IGNORED = new Map<string, string>([
	[`${DCT}created`, 'Dates are set by the app, not imported'],
	[`${DCT}modified`, 'Dates are set by the app, not imported'],
	[SKOS.changeNote, 'Generated from the change log, not imported'],
	[SKOS.historyNote, 'Generated from the change log, not imported']
]);

const emptyConcept = (iri: string): ImportedConcept => ({
	iri, prefLabels: [], altLabels: [], hiddenLabels: [], definition: '', scopeNote: '', notation: [], example: [], editorialNote: [],
	schemeIri: '', topConcept: false, broader: [], related: [], mappings: []
});
const emptyScheme = (iri: string): ImportedScheme => ({ iri, name: '', description: '', title: '', creator: '', publisher: '', rights: '' });
const pushUnique = <T>(list: T[], value: T) => {
	if (!list.some((x) => JSON.stringify(x) === JSON.stringify(value))) list.push(value);
};

export function parseSkosTurtle(text: string, limits: Partial<ImportLimits> = {}): ParsedImport {
	const cap = { ...DEFAULT_IMPORT_LIMITS, ...limits };
	if (text.length > cap.maxBytes) throw new ImportRefused(`The file is too large (limit ${cap.maxBytes} characters)`);
	let quads: Quad[];
	try {
		quads = new Parser().parse(text);
	} catch (e) {
		throw new ImportRefused(`Not valid Turtle: ${e instanceof Error ? e.message : 'parse error'}`);
	}
	for (const q of quads) {
		for (const term of [q.subject, q.object]) {
			if (term.termType === 'NamedNode' && !isSafeSparqlIri(term.value)) throw new ImportRefused(`The file contains an unsafe IRI: ${term.value}`);
			if (term.termType === 'Literal' && term.value.length > cap.maxLiteral) throw new ImportRefused(`A literal is longer than ${cap.maxLiteral} characters`);
		}
		if (q.predicate.termType === 'NamedNode' && !isSafeSparqlIri(q.predicate.value)) throw new ImportRefused(`The file contains an unsafe IRI: ${q.predicate.value}`);
	}

	const errors: ImportIssue[] = [];
	const info: ImportIssue[] = [];
	const skippedMap = new Map<string, SkippedGroup>();
	const skip = (predicate: string, reason: string) => {
		const g = skippedMap.get(predicate);
		if (g) g.count++;
		else skippedMap.set(predicate, { predicate, count: 1, reason });
	};

	const typesOf = new Map<string, Set<string>>();
	for (const q of quads) {
		if (q.predicate.value === RDF_TYPE && q.subject.termType === 'NamedNode') {
			(typesOf.get(q.subject.value) ?? typesOf.set(q.subject.value, new Set()).get(q.subject.value)!).add(q.object.value);
		}
	}
	const kindOf = new Map<string, 'concept' | 'scheme' | 'collection'>();
	const disjointBad = new Set<string>();
	for (const [iri, types] of typesOf) {
		const kinds = new Set<string>();
		if (types.has(SKOS.Concept)) kinds.add('concept');
		if (types.has(SKOS.ConceptScheme)) kinds.add('scheme');
		if (types.has(SKOS.Collection) || types.has(SKOS.OrderedCollection)) kinds.add('collection');
		if (kinds.size > 1) {
			disjointBad.add(iri);
			errors.push({ code: 'disjoint-types', iri, message: `${iri} is typed as both ${[...kinds].join(' and ')}; SKOS keeps concepts, schemes and collections disjoint` });
		} else if (kinds.size === 1) {
			kindOf.set(iri, [...kinds][0] as 'concept');
		}
	}

	const concepts = new Map<string, ImportedConcept>();
	const schemes = new Map<string, ImportedScheme>();
	const hasTop: [string, string][] = [];
	const rdfsNamed = new Set<string>();
	const stated = { broader: new Set<string>(), narrower: new Set<string>(), related: new Set<string>() };
	const conceptOf = (iri: string) => concepts.get(iri) ?? concepts.set(iri, emptyConcept(iri)).get(iri)!;
	const schemeOf = (iri: string) => schemes.get(iri) ?? schemes.set(iri, emptyScheme(iri)).get(iri)!;
	for (const [iri, kind] of kindOf) {
		if (kind === 'concept') conceptOf(iri);
		if (kind === 'scheme') schemeOf(iri);
	}
	const lang = (q: Quad): LangText => ({ text: q.object.value, lang: 'language' in q.object ? (q.object.language as string) : '' });

	for (const q of quads) {
		const s = q.subject.value;
		const p = q.predicate.value;
		if (p === RDF_TYPE) {
			if (![SKOS.Concept, SKOS.ConceptScheme, SKOS.Collection, SKOS.OrderedCollection].some((t) => t === q.object.value)) skip(p, 'Other types are not part of the SKOS subset');
			continue;
		}
		if (q.subject.termType === 'BlankNode') {
			if (p === RDF_FIRST || p === RDF_REST) continue;
			skip(p, 'Triples about blank nodes are not imported');
			continue;
		}
		if (disjointBad.has(s)) continue;
		const kind = kindOf.get(s);
		if (p === SKOS.memberList || (kind === 'collection' && (p === SKOS.member || p === SKOS.prefLabel))) continue;
		if (p.startsWith(SKOSXL_NS)) { skip(p, 'SKOS-XL is not supported'); continue; }
		if (IGNORED.has(p)) { skip(p, IGNORED.get(p)!); continue; }
		if (!kind) {
			skip(p, p.startsWith(SKOS_NS) ? 'The subject is not typed as a concept, scheme or collection' : 'Not SKOS: the subject is not a concept, scheme or collection');
			continue;
		}
		if (p.startsWith(SKOS_NS) && !KNOWN_SKOS.has(p)) { skip(p, 'Unknown SKOS term'); continue; }
		if (kind === 'scheme') {
			const scheme = schemeOf(s);
			if (p === `${RDFS}label`) { scheme.name = q.object.value; rdfsNamed.add(s); }
			else if (p === SKOS.prefLabel) {
				// SKOS files name a scheme with skos:prefLabel; rdfs:label (what the app writes) wins when both are present.
				const lang = (q.object as { language?: string }).language ?? '';
				if (!rdfsNamed.has(s) && (!scheme.name || lang === 'en')) scheme.name = q.object.value;
			}
			else if (p === `${RDFS}comment`) scheme.description = q.object.value;
			else if (p === `${DCT}title`) scheme.title = q.object.value;
			else if (p === `${DCT}creator`) scheme.creator = q.object.value;
			else if (p === `${DCT}publisher`) scheme.publisher = q.object.value;
			else if (p === `${DCT}rights`) scheme.rights = q.object.value;
			else if (p === SKOS.hasTopConcept) hasTop.push([s, q.object.value]);
			else skip(p, p.startsWith(SKOS_NS) ? 'Not a property of a concept scheme in the supported subset' : 'Not SKOS: only labels and Dublin Core terms of a scheme are imported');
			continue;
		}
		if (kind === 'concept') {
			const c = conceptOf(s);
			const o = q.object.value;
			switch (p) {
				case SKOS.prefLabel: pushUnique(c.prefLabels, lang(q)); break;
				case SKOS.altLabel: pushUnique(c.altLabels, lang(q)); break;
				case SKOS.hiddenLabel: pushUnique(c.hiddenLabels, lang(q)); break;
				case SKOS.definition: c.definition = o; break;
				case SKOS.scopeNote: c.scopeNote = o; break;
				case SKOS.notation: pushUnique(c.notation, o); break;
				case SKOS.example: pushUnique(c.example, o); break;
				case SKOS.editorialNote: pushUnique(c.editorialNote, o); break;
				case SKOS.inScheme:
					if (!c.schemeIri) c.schemeIri = o;
					else if (c.schemeIri !== o) info.push({ code: 'multiple-schemes', iri: s, message: `${s} is in more than one scheme; only ${c.schemeIri} is kept` });
					break;
				case SKOS.topConceptOf: c.topConcept = true; if (!c.schemeIri) c.schemeIri = o; break;
				case SKOS.broader: stated.broader.add(`${s} ${o}`); if (s === o) errors.push({ code: 'reflexive-relation', iri: s, message: `${s} is its own broader concept` }); else pushUnique(c.broader, o); break;
				case SKOS.narrower: stated.narrower.add(`${s} ${o}`); if (s === o) errors.push({ code: 'reflexive-relation', iri: s, message: `${s} is its own narrower concept` }); break;
				case SKOS.related: stated.related.add(`${s} ${o}`); if (s === o) errors.push({ code: 'reflexive-relation', iri: s, message: `${s} is related to itself` }); else pushUnique(c.related, o); break;
				default: {
					const kindName = p.slice(SKOS_NS.length) as MappingKind;
					if (p.startsWith(SKOS_NS) && (MAPPING_KINDS as readonly string[]).includes(kindName)) pushUnique(c.mappings, { kind: kindName, target: o });
					else skip(p, p.startsWith(SKOS_NS) ? 'Not a property of a concept in the supported subset' : 'Not SKOS: only SKOS properties of a concept are imported');
				}
			}
			continue;
		}
		skip(p, p.startsWith(SKOS_NS) ? 'Not a property of a collection in the supported subset' : 'Not SKOS: only labels and members of a collection are imported');
	}

	for (const [scheme, top] of hasTop) {
		const c = concepts.get(top);
		if (c) { c.topConcept = true; if (!c.schemeIri) c.schemeIri = scheme; }
	}
	// Fold `narrower` into the other concept's `broader` and make `related` symmetric.
	for (const key of stated.narrower) {
		const [parent, child] = key.split(' ');
		const c = concepts.get(child);
		if (c && child !== parent) pushUnique(c.broader, parent);
		if (c && !stated.broader.has(`${child} ${parent}`)) info.push({ code: 'one-sided-hierarchy', iri: parent, message: `${parent} states narrower ${child} without the matching broader` });
	}
	for (const key of stated.broader) {
		const [child, parent] = key.split(' ');
		if (concepts.has(parent) && !stated.narrower.has(`${parent} ${child}`) && kindOf.has(parent)) {
			// The exporter writes both halves, so a missing inverse is worth a note but not a problem.
			info.push({ code: 'one-sided-hierarchy', iri: child, message: `${child} states broader ${parent} without the matching narrower` });
		}
	}
	for (const key of stated.related) {
		const [a, b] = key.split(' ');
		const other = concepts.get(b);
		if (!other || a === b) continue;
		if (!stated.related.has(`${b} ${a}`)) {
			pushUnique(other.related, a);
			info.push({ code: 'one-sided-related', iri: a, message: `${a} states related ${b} without the matching inverse; both halves are imported` });
		}
	}

	if (concepts.size > cap.maxConcepts) throw new ImportRefused(`The file has more than ${cap.maxConcepts} concepts`);
	const collections = collectionsFromQuads(quads).filter((c) => !disjointBad.has(c.iri));
	const schemeList = [...schemes.values()].filter((s) => !disjointBad.has(s.iri));
	const conceptList = [...concepts.values()].filter((c) => !disjointBad.has(c.iri));
	return {
		schemes: schemeList,
		concepts: conceptList,
		collections,
		skipped: [...skippedMap.values()].sort((a, b) => (a.predicate < b.predicate ? -1 : 1)),
		errors,
		info
	};
}

// -- The plan ------------------------------------------------------------------------------------

export type PlanStatus = 'new' | 'changed' | 'unchanged' | 'conflicting';

export interface PropertyChange {
	property: string;
	before: string;
	after: string;
}

interface EntryBase {
	iri: string;
	status: PlanStatus;
	changes: PropertyChange[];
	/** Why an entry is `conflicting`. */
	reason?: string;
}
export type PlanEntry =
	| (EntryBase & { kind: 'scheme'; imported: ImportedScheme })
	| (EntryBase & { kind: 'concept'; imported: ImportedConcept })
	| (EntryBase & { kind: 'collection'; imported: SkosCollection });

export interface SimilarEntry {
	importedIri: string;
	existingIri: string;
	match: 'equal' | 'similar';
	via: 'preferred' | 'alternative';
	label: string;
}

export interface ImportPlan {
	entries: PlanEntry[];
	similar: SimilarEntry[];
	skipped: SkippedGroup[];
	errors: ImportIssue[];
	info: ImportIssue[];
	counts: Record<PlanStatus, number> & { similar: number; skipped: number; errors: number };
}

const keyOf = (l: LangText) => `${l.lang.toLowerCase()}\u0000${l.text.trim()}`;
const showLabels = (labels: LangText[]) => labels.map((l) => (l.lang ? `${l.text}@${l.lang}` : l.text)).join('; ');
const showMapping = (m: ConceptMapping) => `${m.kind} ${m.target}`;
const kindRank = { scheme: 0, concept: 1, collection: 2 } as const;

function symmetricRelated(concepts: Concept[]): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	const add = (a: string, b: string) => (map.get(a) ?? map.set(a, new Set()).get(a)!).add(b);
	for (const c of concepts) for (const r of c.related ?? []) { add(c.iri, r); add(r, c.iri); }
	return map;
}

function compareConcept(imp: ImportedConcept, ex: Concept, related: Map<string, Set<string>>): { changes: PropertyChange[]; conflict?: string } {
	const changes: PropertyChange[] = [];
	for (const l of imp.prefLabels) {
		const same = ex.prefLabels.find((x) => x.lang.toLowerCase() === l.lang.toLowerCase());
		if (same && same.text.trim() !== l.text.trim()) return { changes, conflict: `The preferred label in ${l.lang || 'no language'} differs: "${same.text}" in the vocabulary, "${l.text}" in the file` };
		if (!same) changes.push({ property: 'prefLabel', before: '', after: showLabels([l]) });
	}
	const addedLabels = (property: string, imported: LangText[], existing: LangText[]) => {
		const have = new Set(existing.map(keyOf));
		const added = imported.filter((l) => !have.has(keyOf(l)));
		if (added.length) changes.push({ property, before: showLabels(existing), after: showLabels(added) });
	};
	addedLabels('altLabel', imp.altLabels, ex.altLabels);
	addedLabels('hiddenLabel', imp.hiddenLabels, ex.hiddenLabels);
	const text = (property: string, imported: string, existing: string) => {
		if (imported.trim() && imported.trim() !== existing.trim()) changes.push({ property, before: existing, after: imported });
	};
	text('definition', imp.definition, ex.definition);
	text('scopeNote', imp.scopeNote, ex.scopeNote);
	text('scheme', imp.schemeIri, ex.schemeIri);
	if (imp.topConcept && !ex.topConcept) changes.push({ property: 'topConcept', before: 'no', after: 'yes' });
	const addedValues = (property: string, imported: string[], existing: string[]) => {
		const added = imported.filter((v) => !existing.includes(v));
		if (added.length) changes.push({ property, before: existing.join('; '), after: added.join('; ') });
	};
	addedValues('notation', imp.notation, ex.notation ?? []);
	addedValues('example', imp.example, ex.example ?? []);
	addedValues('editorialNote', imp.editorialNote, ex.editorialNote ?? []);
	addedValues('broader', imp.broader, ex.broader ?? []);
	addedValues('related', imp.related, [...(related.get(ex.iri) ?? [])]);
	const have = (ex.mappings ?? []).map(showMapping);
	const addedMappings = imp.mappings.map(showMapping).filter((m) => !have.includes(m));
	if (addedMappings.length) changes.push({ property: 'mapping', before: have.join('; '), after: addedMappings.join('; ') });
	return { changes };
}

export function buildImportPlan(parsed: ParsedImport, existing: Pick<SkosVocabulary, 'schemes' | 'concepts' | 'collections'>): ImportPlan {
	const entries: PlanEntry[] = [];
	const related = symmetricRelated(existing.concepts);
	const existingConcepts = new Map(existing.concepts.map((c) => [c.iri, c]));
	const status = (changes: PropertyChange[]): PlanStatus => (changes.length ? 'changed' : 'unchanged');

	// Notations in use per scheme, by whoever holds them, to spot a clash.
	const holders = new Map<string, Set<string>>();
	const hold = (scheme: string, notation: string, iri: string) => {
		const key = `${scheme}\u0000${notation}`;
		(holders.get(key) ?? holders.set(key, new Set()).get(key)!).add(iri);
	};
	for (const c of existing.concepts) if (!parsed.concepts.some((p) => p.iri === c.iri)) for (const n of c.notation ?? []) hold(c.schemeIri, n, c.iri);
	for (const c of parsed.concepts) for (const n of c.notation) hold(c.schemeIri, n, c.iri);

	const existingSchemes = new Map(existing.schemes.map((s) => [s.iri, s]));
	for (const s of parsed.schemes) {
		const ex = existingSchemes.get(s.iri);
		if (!ex) { entries.push({ kind: 'scheme', iri: s.iri, status: 'new', changes: [], imported: s }); continue; }
		const changes: PropertyChange[] = [];
		const diff = (property: string, imported: string, before: string) => {
			if (imported.trim() && imported.trim() !== before.trim()) changes.push({ property, before, after: imported });
		};
		diff('name', s.name, ex.name);
		diff('description', s.description, ex.description);
		diff('title', s.title, ex.metadata?.title ?? '');
		diff('creator', s.creator, ex.metadata?.creator ?? '');
		diff('publisher', s.publisher, ex.metadata?.publisher ?? '');
		diff('rights', s.rights, ex.metadata?.rights ?? '');
		entries.push({ kind: 'scheme', iri: s.iri, status: status(changes), changes, imported: s });
	}

	const similar: SimilarEntry[] = [];
	for (const c of parsed.concepts) {
		const ex = existingConcepts.get(c.iri);
		let entry: PlanEntry;
		if (!ex) {
			entry = { kind: 'concept', iri: c.iri, status: 'new', changes: [], imported: c };
			const label = c.prefLabels[0]?.text ?? '';
			for (const m of findSimilarConcepts(label, existing.concepts)) similar.push({ importedIri: c.iri, existingIri: m.iri, match: m.match, via: m.via, label: m.label });
		} else {
			const { changes, conflict } = compareConcept(c, ex, related);
			entry = conflict
				? { kind: 'concept', iri: c.iri, status: 'conflicting', changes, imported: c, reason: conflict }
				: { kind: 'concept', iri: c.iri, status: status(changes), changes, imported: c };
		}
		for (const n of c.notation) {
			const others = [...(holders.get(`${c.schemeIri}\u0000${n}`) ?? [])].filter((i) => i !== c.iri);
			if (others.length && entry.status !== 'conflicting') {
				entry = { ...entry, status: 'conflicting', reason: `The notation ${n} is already used by ${others[0]} in this scheme` } as PlanEntry;
			}
		}
		entries.push(entry);
	}

	const existingCollections = new Map(existing.collections.map((c) => [c.iri, c]));
	for (const col of parsed.collections) {
		const ex = existingCollections.get(col.iri);
		if (!ex) { entries.push({ kind: 'collection', iri: col.iri, status: 'new', changes: [], imported: col }); continue; }
		const clash = col.prefLabels.find((l) => ex.prefLabels.some((x) => x.lang.toLowerCase() === l.lang.toLowerCase() && x.text.trim() !== l.text.trim()));
		if (clash) {
			entries.push({ kind: 'collection', iri: col.iri, status: 'conflicting', changes: [], imported: col, reason: `The preferred label in ${clash.lang || 'no language'} differs: "${clash.text}" in the file` });
			continue;
		}
		const changes: PropertyChange[] = [];
		const added = col.members.filter((m) => !ex.members.includes(m));
		if (added.length) changes.push({ property: 'member', before: ex.members.join('; '), after: added.join('; ') });
		if (ex.ordered && added.length === 0 && col.members.join() !== ex.members.join() && col.members.length === ex.members.length) {
			changes.push({ property: 'order', before: ex.members.join('; '), after: col.members.join('; ') });
		}
		entries.push({ kind: 'collection', iri: col.iri, status: status(changes), changes, imported: col });
	}

	entries.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || (a.iri < b.iri ? -1 : a.iri > b.iri ? 1 : 0));
	// Entries keep file order within a kind (the parse is in file order); sort only by kind for readability.
	const info = [...parsed.info];
	const known = new Set([...existing.concepts.map((c) => c.iri), ...parsed.concepts.map((c) => c.iri)]);
	for (const c of parsed.concepts) {
		for (const target of [...c.broader, ...c.related]) {
			if (!known.has(target) && !info.some((i) => i.code === 'undefined-concept' && i.iri === c.iri && i.message.includes(target))) {
				info.push({ code: 'undefined-concept', iri: c.iri, message: `${c.iri} points to ${target}, which neither the file nor the vocabulary defines` });
			}
		}
	}
	const counts = { new: 0, changed: 0, unchanged: 0, conflicting: 0, similar: similar.length, skipped: parsed.skipped.reduce((n, s) => n + s.count, 0), errors: parsed.errors.length };
	for (const e of entries) counts[e.status]++;
	return { entries, similar, skipped: parsed.skipped, errors: parsed.errors, info, counts };
}
