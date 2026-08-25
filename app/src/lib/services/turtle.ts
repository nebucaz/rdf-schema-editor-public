/**
 * RDF quad parsing/serialization for the "raw triples" view/editor (STORY-011/012), plus the pure
 * scope-selection logic shared by both the read (view) and write (save) paths so a selected
 * entity/relation's triples are computed identically everywhere. Uses `n3` (RDF/JS-compliant
 * terms/quads) as the one RDF representation in the codebase — chosen so STORY-013's validation
 * layer can operate on the same `Quad[]` without a second parsing pass.
 */
import { Parser, Writer, DataFactory, type Quad, type Quad_Object, type Term } from 'n3';
import { nodeShapeIri, SCHEMA_NAMESPACE, SHAPES_NAMESPACE, XSD_NAMESPACE } from '$lib/utils/iri';
import { namespaceGraphs } from '$lib/config';
import type { SparqlBinding } from './sparql-connector';

export type { Quad };

// -- Vocabulary IRIs used by scope-selection and validation ------------------------------------

const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';
const OWL_NS = 'http://www.w3.org/2002/07/owl#';
export const SH_NS = 'http://www.w3.org/ns/shacl#';

export const RDF = { type: `${RDF_NS}type` };
export const RDFS = {
	subClassOf: `${RDFS_NS}subClassOf`,
	domain: `${RDFS_NS}domain`,
	range: `${RDFS_NS}range`,
	label: `${RDFS_NS}label`,
	comment: `${RDFS_NS}comment`
};
export const OWL = {
	Class: `${OWL_NS}Class`,
	DatatypeProperty: `${OWL_NS}DatatypeProperty`,
	ObjectProperty: `${OWL_NS}ObjectProperty`
};
export const SH = {
	NodeShape: `${SH_NS}NodeShape`,
	property: `${SH_NS}property`,
	path: `${SH_NS}path`,
	targetClass: `${SH_NS}targetClass`
};

/** Prefixes for the human-facing Turtle view (STORY-011) — matches `semantic-crm`'s
 *  `gcrm-shema.ttl`/`gcrm-shapes.ttl` style, including a hyphenated shapes prefix. Used as the
 *  default when no registered-namespace list is available; `buildDisplayPrefixes` (STORY-048)
 *  supersedes this with one `rse`/`rse-sh`-shaped pair per registered namespace. */
const DISPLAY_PREFIXES = {
	rdf: RDF_NS,
	rdfs: RDFS_NS,
	owl: OWL_NS,
	xsd: XSD_NAMESPACE,
	sh: SH_NS,
	rse: SCHEMA_NAMESPACE,
	'rse-sh': SHAPES_NAMESPACE
};

/**
 * Builds the full display-prefix map (STORY-048): standard vocabulary prefixes plus, for every
 * registered namespace, two prefixes mirroring the default namespace's own `rse`/`rse-sh` pair —
 * `<prefix>` for its schema vocabulary IRI, `<prefix>-sh` for its shapes vocabulary IRI — so the
 * raw Turtle view can show and accept e.g. `core:BusinessProcess` for any registered namespace,
 * not just the default one. The default namespace is expected to already be among `namespaces`
 * (`fetchNamespaces()` includes it), so no separate `rse`/`rse-sh` entry is added here.
 *
 * `externalVocabularies` (STORY-050) adds one flat prefix per entry — unlike a registered
 * namespace, an external vocabulary (e.g. `gist`, STORY-046) is only ever *referenced* (as an
 * `rdfs:subClassOf` target, say), never a graph this app writes to, so there's no schema/shapes
 * split to mirror. A namespace's own prefix always wins over a same-named external vocabulary
 * entry, since namespaces are this app's authoritative, locally-owned data.
 */
export function buildDisplayPrefixes(
	namespaces: { prefix: string; baseIri: string }[],
	externalVocabularies: { prefix: string; baseIri: string }[] = []
): Record<string, string> {
	const prefixes: Record<string, string> = {
		rdf: RDF_NS,
		rdfs: RDFS_NS,
		owl: OWL_NS,
		xsd: XSD_NAMESPACE,
		sh: SH_NS
	};
	for (const vocab of externalVocabularies) {
		if (!vocab.prefix) continue;
		prefixes[vocab.prefix] = vocab.baseIri;
	}
	for (const ns of namespaces) {
		if (!ns.prefix) continue;
		const graphs = namespaceGraphs(ns.baseIri);
		prefixes[ns.prefix] = `${graphs.schema}#`;
		prefixes[`${ns.prefix}-sh`] = `${graphs.shapes}#`;
	}
	return prefixes;
}

export function isRdfType(q: Quad, typeIri: string): boolean {
	return q.predicate.value === RDF.type && q.object.value === typeIri;
}

/** Parses Turtle text into quads. Throws with the parser's own message, which includes
 *  line/column info (e.g. "Undefined prefix ... on line 3") — surfaced as-is to the editor UI. */
export function parseTurtle(text: string): Quad[] {
	return new Parser().parse(text);
}

/** Serializes quads as human-facing Turtle with standard prefixes (STORY-011's view), plus
 *  whichever registered-namespace prefixes `prefixes` supplies (STORY-048's `buildDisplayPrefixes`)
 *  — defaults to the static `rse`/`rse-sh`-only map when no registered-namespace list is available. */
export function quadsToTurtle(quads: Quad[], prefixes: Record<string, string> = DISPLAY_PREFIXES): Promise<string> {
	return new Promise((resolve, reject) => {
		const writer = new Writer({ prefixes });
		writer.addQuads(quads);
		writer.end((err, result) => (err ? reject(err) : resolve(result)));
	});
}

/** Serializes quads as ground N-Triples with no prefixes — used inside a SPARQL `INSERT DATA`
 *  block, matching the rest of `sparql-connector.ts`'s style of always using full `<IRI>` forms. */
export function quadsToGroundTriples(quads: Quad[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const writer = new Writer({ format: 'N-Triples' });
		writer.addQuads(quads);
		writer.end((err, result) => (err ? reject(err) : resolve(result)));
	});
}

/** Serializes quads as N-Quads (STORY-036's "Export quads" download) — each quad's graph term
 *  (set by `bindingToQuad`'s `graph` argument) is written out per line, unlike
 *  `quadsToGroundTriples`'s N-Triples which drops it. */
export function quadsToNQuads(quads: Quad[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const writer = new Writer({ format: 'N-Quads' });
		writer.addQuads(quads);
		writer.end((err, result) => (err ? reject(err) : resolve(result)));
	});
}

// -- Schema/shapes partitioning (STORY-014) -----------------------------------------------------

/**
 * Splits a mixed `Quad[]` into the schema (`owl:Class`/`owl:*Property`/individuals) and shapes
 * (`sh:NodeShape`/`sh:property`) buckets, per `research.md` §4.1: predicate-based (any `sh:*`
 * predicate), blank-node-based (every `sh:property` shape is a blank node), or an explicit `a
 * sh:NodeShape` type declaration — the last of these catches a `NodeShape` subject's own `rdf:type`
 * triple regardless of which namespace it was minted under (STORY-048 fix: the old
 * `SHAPES_NAMESPACE`-prefix check only matched the *default* namespace's shapes IRIs, so a
 * non-default namespace's `<...core/shapes#FooShape> a sh:NodeShape` triple fell through to the
 * schema bucket — and, once round-tripped through a scoped save, got written into that namespace's
 * *schema* graph instead of its shapes graph). Every input quad appears in exactly one output
 * bucket.
 */
export function partitionQuads(quads: Quad[]): { schema: Quad[]; shapes: Quad[] } {
	const schema: Quad[] = [];
	const shapes: Quad[] = [];
	for (const q of quads) {
		const isShapesBucket =
			q.predicate.value.startsWith(SH_NS) ||
			q.subject.termType === 'BlankNode' ||
			isRdfType(q, SH.NodeShape);
		(isShapesBucket ? shapes : schema).push(q);
	}
	return { schema, shapes };
}

// -- Deterministic schema ordering (STORY-015) ---------------------------------------------------

/**
 * Orders the schema partition as: class, then that class's own properties, then (once STORY-019's
 * individuals land) that class's own individuals — then the next class, and so on — matching
 * `example-schema.ttl`/`gcrm-shema.ttl`'s layout instead of arrival order (`research.md` §4.5(a)).
 * Pure serialize-time computation: recomputed fresh on every call, nothing stored. Same-subject
 * quads end up adjacent so `n3.Writer` collapses them into one `;`-block.
 */
export function groupSchemaQuads(schemaQuads: Quad[]): Quad[] {
	/** `rdf:type` first, then alphabetically by predicate — so a subject's own quads sort the same
	 *  way no matter what order GraphDB happened to return them in (there's no `ORDER BY` on
	 *  `fetchWholeGraphQuads`, per `research.md` §4.6). */
	function predicateSortKey(q: Quad): string {
		return q.predicate.value === RDF.type ? '' : q.predicate.value;
	}

	const bySubject = new Map<string, Quad[]>();
	for (const q of schemaQuads) {
		const key = q.subject.value;
		const list = bySubject.get(key) ?? [];
		list.push(q);
		bySubject.set(key, list);
	}
	for (const list of bySubject.values()) {
		list.sort((a, b) => predicateSortKey(a).localeCompare(predicateSortKey(b)));
	}

	// Sorting subject keys themselves (rather than trusting arrival order, which
	// `fetchWholeGraphQuads` doesn't guarantee stable) is what makes the whole grouping a pure
	// function of the graph's *content* — required for AC 3's "byte-identical regardless of arrival
	// order", since first-appearance order is otherwise just a reflection of input order.
	const allSubjectKeys = [...bySubject.keys()].sort((a, b) => a.localeCompare(b));

	const classIris = allSubjectKeys.filter((key) =>
		(bySubject.get(key) ?? []).some((q) => isRdfType(q, OWL.Class))
	);
	const classIriSet = new Set(classIris);

	/** A subject's owning class: its `rdfs:domain` for a property, its `rdf:type` object for an
	 *  individual (STORY-019) — `undefined` for a class itself or anything without either. */
	function owningClass(key: string): string | undefined {
		const quads = bySubject.get(key) ?? [];
		const domainQuad = quads.find((q) => q.predicate.value === RDFS.domain);
		if (domainQuad) return domainQuad.object.value;
		const typeQuad = quads.find((q) => q.predicate.value === RDF.type && classIriSet.has(q.object.value));
		if (typeQuad) return typeQuad.object.value;
		return undefined;
	}

	const ownedBy = new Map<string, string[]>();
	const unowned: string[] = [];
	for (const key of allSubjectKeys) {
		if (classIriSet.has(key)) continue;
		const owner = owningClass(key);
		if (owner && classIriSet.has(owner)) {
			const list = ownedBy.get(owner) ?? [];
			list.push(key);
			ownedBy.set(owner, list);
		} else {
			unowned.push(key);
		}
	}

	const ordered: Quad[] = [];
	for (const classKey of classIris) {
		ordered.push(...(bySubject.get(classKey) ?? []));
		for (const ownedKey of ownedBy.get(classKey) ?? []) {
			ordered.push(...(bySubject.get(ownedKey) ?? []));
		}
	}
	for (const key of unowned) {
		ordered.push(...(bySubject.get(key) ?? []));
	}

	return ordered;
}

// -- Nested blank-node shapes serialization (STORY-016) ------------------------------------------

/**
 * Serializes the shapes partition with `sh:property` blank nodes nested inline
 * (`sh:property [ sh:path ...; sh:minCount 1 ]`) instead of `n3.Writer`'s default flat,
 * disconnected `_:b0` statement (`research.md` §4.3 spike). A blank-node subject referenced as the
 * object of exactly one other triple is pulled out of the top-level list and re-attached via
 * `writer.blank(...)`, recursively (arbitrary nesting depth). A blank node shared across more than
 * one reference (hand-edit-only case) can't be nested at more than one place, so it falls back to
 * ordinary labeled `_:` top-level output for that node only — the rest of the serialize still
 * succeeds.
 *
 * `n3.Writer.end()`'s callback fires synchronously when writing to a string (no stream target) —
 * confirmed against the installed `n3@1.26.0` — so this can return `string` directly rather than a
 * `Promise`, unlike `quadsToTurtle`.
 *
 * `prefixes` mirrors `quadsToTurtle`'s parameter (STORY-048) — defaults to the static
 * `rse`/`rse-sh`-only map when no registered-namespace list is available.
 */
export function nestBlankNodes(quads: Quad[], prefixes: Record<string, string> = DISPLAY_PREFIXES): string {
	const bySubject = new Map<string, Quad[]>();
	for (const q of quads) {
		const key = `${q.subject.termType}|${q.subject.value}`;
		const list = bySubject.get(key) ?? [];
		list.push(q);
		bySubject.set(key, list);
	}

	const blankRefCount = new Map<string, number>();
	for (const q of quads) {
		if (q.object.termType === 'BlankNode') {
			blankRefCount.set(q.object.value, (blankRefCount.get(q.object.value) ?? 0) + 1);
		}
	}

	const writer = new Writer({ prefixes });
	const isNestable = (blankValue: string) => (blankRefCount.get(blankValue) ?? 0) === 1;

	function buildObject(term: Quad_Object): Quad_Object {
		if (term.termType === 'BlankNode' && isNestable(term.value)) {
			const own = bySubject.get(`BlankNode|${term.value}`) ?? [];
			return writer.blank(own.map((q) => ({ predicate: q.predicate, object: buildObject(q.object) })));
		}
		return term;
	}

	for (const subjectQuads of bySubject.values()) {
		const subject = subjectQuads[0].subject;
		if (subject.termType === 'BlankNode' && isNestable(subject.value)) continue; // nested elsewhere
		for (const q of subjectQuads) {
			writer.addQuad(q.subject, q.predicate, buildObject(q.object), q.graph);
		}
	}

	let result = '';
	writer.end((err, res) => {
		if (err) throw err;
		result = res;
	});
	return result;
}

function termKey(term: Term): string {
	if (term.termType === 'Literal') {
		return `L|${term.value}|${term.datatype.value}|${term.language}`;
	}
	return `${term.termType}|${term.value}`;
}

/** Stable identity key for a quad *within one originating fetch* — safe for set membership and
 *  diffing since blank node labels are only meaningful relative to the query that produced them
 *  (see `selectScope`'s doc comment). Not meaningful across two independent SPARQL round-trips. */
export function quadKey(q: Quad): string {
	return `${termKey(q.subject)}|${termKey(q.predicate)}|${termKey(q.object)}`;
}

/** Converts one SPARQL-JSON `?s ?p ?o` result row into a quad, using the plain SPARQL 1.1 results
 *  JSON term types (`uri`/`literal`/`bnode`). `graph` (STORY-036) tags the quad with its originating
 *  named graph IRI — omitted (the default), the quad carries `DefaultGraph`, preserving every
 *  pre-existing call site's behavior (scope-selection/validation never look at the graph term). */
export function bindingToQuad(b: SparqlBinding, graph?: string): Quad {
	const s = b.s,
		p = b.p,
		o = b.o;
	const subject = s.type === 'bnode' ? DataFactory.blankNode(s.value) : DataFactory.namedNode(s.value);
	const predicate = DataFactory.namedNode(p.value);
	let object: Term;
	if (o.type === 'bnode') {
		object = DataFactory.blankNode(o.value);
	} else if (o.type === 'literal' || o.type === 'typed-literal') {
		object = o.datatype
			? DataFactory.literal(o.value, DataFactory.namedNode(o.datatype))
			: DataFactory.literal(o.value, o['xml:lang']);
	} else {
		object = DataFactory.namedNode(o.value);
	}
	return DataFactory.quad(subject, predicate, object, graph ? DataFactory.namedNode(graph) : undefined);
}

/** Which bucket of a scope's triples to select/save — `'all'` (default) preserves STORY-012/013's
 *  combined behavior; `'schema'`/`'shapes'` filter the same selection through STORY-014's
 *  `partitionQuads` rule (STORY-017), letting the Schema and Shapes tabs (STORY-018) save
 *  independently. */
export type Partition = 'schema' | 'shapes' | 'all';

/**
 * Selects the triples in scope for a given canvas selection, out of the full set of quads for the
 * whole graph (STORY-011's scoping rule, reused unchanged for STORY-012's save-time "old scope"
 * computation so both paths agree on exactly the same triples):
 *
 * - `iri === null`: the whole graph.
 * - `iri` is an `owl:Class`: its own triples, plus its `sh:NodeShape`'s own triples, plus every
 *   `sh:property` blank node hanging off that shape (and *their* triples), plus its own individuals
 *   (STORY-019 — every `rdf:type <iri>` subject's own triples).
 * - `iri` is an `owl:DatatypeProperty`/`owl:ObjectProperty`: its own triples, plus (if found) the
 *   single `sh:property` blank node under its domain class's shape whose `sh:path` is this `iri`.
 *
 * `partition` (STORY-017) applies STORY-014's schema/shapes split as a final filter over this same
 * selection, rather than a second, independent selection algorithm — `'all'` (default) returns the
 * selection unfiltered.
 *
 * Must only ever be called with `allQuads` from a *single* SPARQL round-trip — blank node labels
 * are only guaranteed consistent within one query's result set, not across separate queries.
 */
export function selectScope(allQuads: Quad[], iri: string | null, partition: Partition = 'all'): Quad[] {
	const scoped = selectScopeUnfiltered(allQuads, iri);
	if (partition === 'all') return scoped;
	const { schema, shapes } = partitionQuads(scoped);
	return partition === 'schema' ? schema : shapes;
}

function selectScopeUnfiltered(allQuads: Quad[], iri: string | null): Quad[] {
	if (iri === null) return allQuads;

	const own = allQuads.filter((q) => q.subject.value === iri);
	const isClass = own.some((q) => isRdfType(q, OWL.Class));

	if (isClass) {
		const shapeIri = nodeShapeIri(iri);
		const shapeOwn = allQuads.filter((q) => q.subject.value === shapeIri);
		const propertyShapeIds = shapeOwn
			.filter((q) => q.predicate.value === SH.property)
			.map((q) => q.object.value);
		const propertyShapeQuads = allQuads.filter((q) => propertyShapeIds.includes(q.subject.value));
		const individualIds = allQuads
			.filter((q) => isRdfType(q, iri))
			.map((q) => q.subject.value);
		const individualQuads = allQuads.filter((q) => individualIds.includes(q.subject.value));
		return [...own, ...shapeOwn, ...propertyShapeQuads, ...individualQuads];
	}

	const isProperty = own.some(
		(q) => isRdfType(q, OWL.DatatypeProperty) || isRdfType(q, OWL.ObjectProperty)
	);
	if (isProperty) {
		const domainQuad = own.find((q) => q.predicate.value === RDFS.domain);
		if (!domainQuad) return own;
		const shapeIri = nodeShapeIri(domainQuad.object.value);
		const propertyShapeIds = allQuads
			.filter((q) => q.subject.value === shapeIri && q.predicate.value === SH.property)
			.map((q) => q.object.value);
		const matchingId = propertyShapeIds.find((bnodeId) =>
			allQuads.some(
				(q) => q.subject.value === bnodeId && q.predicate.value === SH.path && q.object.value === iri
			)
		);
		if (!matchingId) return own;
		const propShapeQuads = allQuads.filter((q) => q.subject.value === matchingId);
		return [...own, ...propShapeQuads];
	}

	return own;
}
