/**
 * SKOS Turtle export (skos-support STORY-411). Pure: it serialises vocabulary data that is already loaded and
 * writes nothing. The output is sorted so two runs on the same input are byte-identical and can be diffed.
 * Only Turtle is offered (RDF/XML and JSON-LD are declined). Both halves of every `related` pair and every
 * `broader`/`narrower` pair are stated, because the app stores each only once.
 */
import { DataFactory, Writer, type Quad, type Quad_Object, type Term } from 'n3';
import { SKOS, CONCEPT_AUTHORITY_PREDICATE_IRI, CONCEPT_DEPRECATION_REASON_PREDICATE_IRI, CONCEPT_DEPRECATED_ON_PREDICATE_IRI, CONCEPT_DISAMBIGUATION_PREDICATE_IRI, CONCEPT_REPLACED_BY_PREDICATE_IRI, CONCEPT_SOURCE_PREDICATE_IRI, CONCEPT_STATUS_PREDICATE_IRI, SCHEME_DECISIONS_PREDICATE_IRI, SCHEME_OUT_OF_SCOPE_PREDICATE_IRI, SCHEME_PURPOSE_PREDICATE_IRI, SCHEME_STAKEHOLDERS_PREDICATE_IRI } from '#lib/utils/iri.js';
import { SCHEMA_NAMESPACE } from '#lib/config.js';
import { MAPPING_KINDS, type Concept, type ConceptScheme, type LangText } from './skos-concept';
import { collectionToQuads, type SkosCollection } from './skos-collection';
import type { HistoryNote } from './change-log';
import { classifyAgent } from './scheme-metadata';

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDFS = 'http://www.w3.org/2000/01/rdf-schema#';
const DCT = 'http://purl.org/dc/terms/';
const OWL_DEPRECATED = 'http://www.w3.org/2002/07/owl#deprecated';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

export interface SkosVocabulary {
	schemes: ConceptScheme[];
	concepts: Concept[];
	collections: SkosCollection[];
	/** Classes linked to a concept by `rse:definedByConcept`, for the optional `skos:exactMatch` rendering. */
	classLinks?: { classIri: string; conceptIri: string }[];
	/** Change-log entries per concept IRI, rendered as `skos:changeNote`. */
	history?: Record<string, HistoryNote[]>;
}

export interface SkosExportOptions {
	/** One scheme; the whole vocabulary graph when absent. */
	schemeIri?: string;
	includeEditorialNotes?: boolean;
	/** `rse:` fields, `rse:status`, `owl:deprecated` and `rse:replacedBy`. */
	includeProjectPredicates?: boolean;
	/** `skos:exactMatch` from a class to its concept, in the export only. */
	classExactMatch?: boolean;
}

const lit = (text: string, lang = '') => (lang ? literal(text, lang) : literal(text));
const date = (value: string) => literal(value, namedNode(`${XSD}date`));

/** The collections that belong with the exported concepts: any holding an exported concept or an included collection. */
function collectionsFor(all: SkosCollection[], conceptIris: Set<string>, whole: boolean): SkosCollection[] {
	if (whole) return all;
	const included = new Set<string>();
	let grew = true;
	while (grew) {
		grew = false;
		for (const col of all) {
			if (included.has(col.iri)) continue;
			if (col.members.some((m) => conceptIris.has(m) || included.has(m))) {
				included.add(col.iri);
				grew = true;
			}
		}
	}
	return all
		.filter((c) => included.has(c.iri))
		.map((c) => ({ ...c, members: c.members.filter((m) => conceptIris.has(m) || included.has(m)) }));
}

export function skosExportQuads(vocab: SkosVocabulary, options: SkosExportOptions = {}): Quad[] {
	const whole = !options.schemeIri;
	const schemes = vocab.schemes.filter((s) => whole || s.iri === options.schemeIri);
	const concepts = vocab.concepts.filter((c) => whole || c.schemeIri === options.schemeIri);
	const iris = new Set(concepts.map((c) => c.iri));
	const quads: Quad[] = [];
	const add = (s: string, p: string, o: Quad_Object) => quads.push(quad(namedNode(s), namedNode(p), o));
	const rse = options.includeProjectPredicates;
	const texts = (s: string, p: string, values: (string | undefined)[] | undefined) => {
		for (const v of values ?? []) if (v?.trim()) add(s, p, lit(v));
	};
	const labels = (s: string, p: string, values: LangText[]) => {
		for (const v of values) if (v.text.trim()) add(s, p, lit(v.text, v.lang));
	};

	for (const scheme of schemes) {
		add(scheme.iri, RDF_TYPE, namedNode(SKOS.ConceptScheme));
		if (scheme.name) add(scheme.iri, `${RDFS}label`, lit(scheme.name));
		if (scheme.description) add(scheme.iri, `${RDFS}comment`, lit(scheme.description));
		const m = scheme.metadata;
		if (m?.title) add(scheme.iri, `${DCT}title`, lit(m.title));
		for (const [p, v] of [[`${DCT}creator`, m?.creator], [`${DCT}publisher`, m?.publisher]] as const) {
			const agent = classifyAgent(v ?? '');
			if (agent) add(scheme.iri, p, agent.kind === 'iri' ? namedNode(agent.value) : lit(agent.value));
		}
		if (m?.rights) add(scheme.iri, `${DCT}rights`, lit(m.rights));
		if (m?.modified) add(scheme.iri, `${DCT}modified`, literal(m.modified, namedNode(`${XSD}dateTime`)));
		if (rse) {
			for (const [p, v] of [
				[SCHEME_PURPOSE_PREDICATE_IRI, scheme.scope.purpose],
				[SCHEME_DECISIONS_PREDICATE_IRI, scheme.scope.decisionsSupported],
				[SCHEME_OUT_OF_SCOPE_PREDICATE_IRI, scheme.scope.outOfScope],
				[SCHEME_STAKEHOLDERS_PREDICATE_IRI, scheme.scope.stakeholders]
			] as const) if (v) add(scheme.iri, p, lit(v));
		}
	}

	for (const c of concepts) {
		add(c.iri, RDF_TYPE, namedNode(SKOS.Concept));
		labels(c.iri, SKOS.prefLabel, c.prefLabels);
		labels(c.iri, SKOS.altLabel, c.altLabels);
		labels(c.iri, SKOS.hiddenLabel, c.hiddenLabels);
		labels(c.iri, SKOS.definition, c.definitions);
		labels(c.iri, SKOS.scopeNote, c.scopeNotes);
		texts(c.iri, SKOS.notation, c.notation);
		texts(c.iri, SKOS.example, c.example);
		if (options.includeEditorialNotes) texts(c.iri, SKOS.editorialNote, c.editorialNote);
		if (c.created) add(c.iri, `${DCT}created`, date(c.created));
		if (c.modified) add(c.iri, `${DCT}modified`, date(c.modified));
		if (c.schemeIri) {
			add(c.iri, SKOS.inScheme, namedNode(c.schemeIri));
			if (c.topConcept) {
				add(c.iri, SKOS.topConceptOf, namedNode(c.schemeIri));
				add(c.schemeIri, SKOS.hasTopConcept, namedNode(c.iri));
			}
		}
		for (const b of c.broader ?? []) add(c.iri, SKOS.broader, namedNode(b));
		for (const n of vocab.concepts.filter((x) => x.broader?.includes(c.iri))) add(c.iri, SKOS.narrower, namedNode(n.iri));
		for (const r of c.related ?? []) add(c.iri, SKOS.related, namedNode(r));
		for (const r of vocab.concepts.filter((x) => x.related?.includes(c.iri))) add(c.iri, SKOS.related, namedNode(r.iri));
		for (const m of c.mappings ?? []) if (MAPPING_KINDS.includes(m.kind)) add(c.iri, SKOS[m.kind], namedNode(m.target));
		for (const h of vocab.history?.[c.iri] ?? []) {
			add(c.iri, SKOS.changeNote, lit(`${h.changedAt.slice(0, 10)} ${h.changedBy}: ${h.summary}${h.version ? ` (v${h.version})` : ''}`));
		}
		if (rse) {
			texts(c.iri, CONCEPT_STATUS_PREDICATE_IRI, [c.status]);
			texts(c.iri, CONCEPT_DISAMBIGUATION_PREDICATE_IRI, [c.disambiguation]);
			texts(c.iri, CONCEPT_SOURCE_PREDICATE_IRI, [c.source]);
			texts(c.iri, CONCEPT_AUTHORITY_PREDICATE_IRI, [c.authority]);
			texts(c.iri, CONCEPT_DEPRECATION_REASON_PREDICATE_IRI, [c.deprecationReason]);
			if (c.deprecatedOn) add(c.iri, CONCEPT_DEPRECATED_ON_PREDICATE_IRI, date(c.deprecatedOn));
			if (c.status === 'deprecated' || c.status === 'retired') add(c.iri, OWL_DEPRECATED, literal('true', namedNode(`${XSD}boolean`)));
			if (c.replacedBy) add(c.iri, CONCEPT_REPLACED_BY_PREDICATE_IRI, namedNode(c.replacedBy));
		}
	}

	for (const col of collectionsFor(vocab.collections, iris, whole)) {
		const slug = col.iri.split(/[#/]/).pop() ?? 'c';
		quads.push(...collectionToQuads(col, (i) => `${slug}_${i}`));
	}
	if (options.classExactMatch) {
		for (const l of vocab.classLinks ?? []) if (iris.has(l.conceptIri)) add(l.classIri, SKOS.exactMatch, namedNode(l.conceptIri));
	}
	return quads;
}

const termKey = (t: Term) => `${t.termType}|${t.value}|${'language' in t ? t.language : ''}|${'datatype' in t ? (t.datatype as Term).value : ''}`;
const quadKey = (q: Quad) => [q.subject, q.predicate, q.object].map(termKey).join('\u0001');

/** Sorted, deduplicated Turtle with the standard prefixes. */
export function serializeSkosTurtle(vocab: SkosVocabulary, options: SkosExportOptions = {}): string {
	const seen = new Set<string>();
	const unique = skosExportQuads(vocab, options).filter((q) => !seen.has(quadKey(q)) && seen.add(quadKey(q)));
	unique.sort((a, b) => (quadKey(a) < quadKey(b) ? -1 : quadKey(a) > quadKey(b) ? 1 : 0));
	const writer = new Writer({
		prefixes: {
			skos: SKOS.Concept.replace('Concept', ''),
			dct: DCT,
			rdfs: RDFS,
			owl: 'http://www.w3.org/2002/07/owl#',
			xsd: XSD,
			rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
			rse: SCHEMA_NAMESPACE
		}
	});
	writer.addQuads(unique);
	let result = '';
	writer.end((_, r) => (result = r));
	return result;
}
