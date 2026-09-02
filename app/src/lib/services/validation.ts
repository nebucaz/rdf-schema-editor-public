/**
 * SHACL well-formedness + OWL/RDFS structural validation (STORY-013), layered on top of
 * STORY-012's syntax-only check. Both checkers are pure functions over already-parsed quads (see
 * `turtle.ts`), independent of GraphDB, per `plan.md`'s validation-scope ADR: no OWL2-RL
 * consistency reasoning, just shape well-formedness + hand-written structural checks.
 *
 * Neither `shacl-engine` nor `rdf-validate-shacl` exposes a "is this shapes graph itself
 * well-formed" entry point (both validate *data* against shapes, per `research.md` §3.5) — so
 * well-formedness here is checked by directly walking the parsed quads rather than pulling in
 * either library for what would only ever be a thin, hand-rolled wrapper around it anyway.
 */
import { isRdfType, DCAT, DCT, OWL, RDF, RDFS, SH, type Quad } from './turtle';
import { XSD_NAMESPACE, BACKSTAGE_KIND_PREDICATE_IRI } from '$lib/utils/iri';

export interface ValidationIssue {
	layer: 'syntax' | 'shacl' | 'structural';
	message: string;
	/** `'warning'` marks an issue that must not block a save (Backstage-mapping Story 005) — every
	 *  pre-existing check omits this field, which is treated as `'error'` (blocking), so this is
	 *  additive: no prior caller's behavior changes unless it explicitly opts into filtering
	 *  warnings out before throwing `SchemaValidationError`. */
	severity?: 'error' | 'warning';
}

export class SchemaValidationError extends Error {
	issues: ValidationIssue[];

	constructor(issues: ValidationIssue[]) {
		super(issues.map((i) => `[${i.layer}] ${i.message}`).join('; '));
		this.name = 'SchemaValidationError';
		this.issues = issues;
	}
}

/**
 * Checks well-formedness of `sh:NodeShape`/`sh:property` shapes found in `editedQuads` (the
 * edited scope only, per STORY-013's description — pre-existing shapes elsewhere in the graph
 * aren't re-checked on every unrelated save). `declaredClasses` comes from the *whole* graph
 * (post-edit), since a shape's `sh:targetClass` may legitimately point at a class declared
 * outside the edited scope.
 */
export function checkShaclWellFormedness(
	editedQuads: Quad[],
	declaredClasses: ReadonlySet<string>
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const propertyShapeIds = new Set(
		editedQuads.filter((q) => q.predicate.value === SH.property).map((q) => q.object.value)
	);
	for (const shapeId of propertyShapeIds) {
		const pathQuads = editedQuads.filter(
			(q) => q.subject.value === shapeId && q.predicate.value === SH.path
		);
		if (pathQuads.length === 0) {
			issues.push({
				layer: 'shacl',
				message: `sh:property blank node "${shapeId}" is missing sh:path`
			});
		} else if (pathQuads.length > 1) {
			issues.push({
				layer: 'shacl',
				message: `sh:property blank node "${shapeId}" has more than one sh:path`
			});
		}
	}

	const nodeShapes = editedQuads.filter((q) => isRdfType(q, SH.NodeShape));
	for (const shape of nodeShapes) {
		const targetClassQuads = editedQuads.filter(
			(q) => q.subject.value === shape.subject.value && q.predicate.value === SH.targetClass
		);
		for (const tc of targetClassQuads) {
			if (!declaredClasses.has(tc.object.value)) {
				issues.push({
					layer: 'shacl',
					message: `sh:NodeShape <${shape.subject.value}> has sh:targetClass <${tc.object.value}>, which is not declared as owl:Class`
				});
			}
		}
	}

	return issues;
}

/** Whole-graph `rdfs:subClassOf` cycle detection via DFS, reporting the actual cycle path. */
function findSubClassOfCycle(quads: Quad[]): string[] | null {
	const edges = new Map<string, string[]>();
	for (const q of quads) {
		if (q.predicate.value !== RDFS.subClassOf) continue;
		const list = edges.get(q.subject.value) ?? [];
		list.push(q.object.value);
		edges.set(q.subject.value, list);
	}

	const visiting = new Set<string>();
	const visited = new Set<string>();
	const stack: string[] = [];

	function dfs(node: string): string[] | null {
		visiting.add(node);
		stack.push(node);
		for (const next of edges.get(node) ?? []) {
			if (visiting.has(next)) {
				const cycleStart = stack.indexOf(next);
				return [...stack.slice(cycleStart), next];
			}
			if (!visited.has(next)) {
				const found = dfs(next);
				if (found) return found;
			}
		}
		stack.pop();
		visiting.delete(node);
		visited.add(node);
		return null;
	}

	for (const node of edges.keys()) {
		if (!visited.has(node)) {
			const found = dfs(node);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Whole-graph (post-edit) OWL/RDFS structural checks: `rdfs:subClassOf` cycles anywhere in the
 * graph (stronger than STORY-008's local-only guard), dangling `rdfs:domain`/`rdfs:range`
 * (must reference a declared `owl:Class`, or — for range — a built-in XSD datatype), and
 * conflicting `rdfs:range` declarations for the same property IRI.
 *
 * `authoritativeEntityClassIri` (Sprint 5 Story 014, `null` by default) is the user-configured
 * catalog marker class, replacing the old hardcoded `AUTHORITATIVE_ENTITY_IRI` constant — the
 * backstageKind/ancestry warning below is skipped entirely when `null` (nothing configured to
 * check against yet) rather than firing against a nonexistent marker.
 */
export function checkStructural(
	quads: Quad[],
	authoritativeEntityClassIri: string | null = null
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	const declaredClasses = new Set(
		quads.filter((q) => isRdfType(q, OWL.Class)).map((q) => q.subject.value)
	);

	const cycle = findSubClassOfCycle(quads);
	if (cycle) {
		issues.push({
			layer: 'structural',
			message: `rdfs:subClassOf cycle detected: ${cycle.map((iri) => `<${iri}>`).join(' -> ')}`
		});
	}

	for (const q of quads) {
		if (q.predicate.value === RDFS.domain && !declaredClasses.has(q.object.value)) {
			issues.push({
				layer: 'structural',
				message: `<${q.subject.value}> rdfs:domain <${q.object.value}>, which is not declared as owl:Class`
			});
		}
		if (
			q.predicate.value === RDFS.range &&
			!q.object.value.startsWith(XSD_NAMESPACE) &&
			!declaredClasses.has(q.object.value)
		) {
			issues.push({
				layer: 'structural',
				message: `<${q.subject.value}> rdfs:range <${q.object.value}>, which is not declared as owl:Class`
			});
		}
	}

	// STORY-019: an individual's `rdf:type` target (any `a` object that isn't one of the ontology
	// languages' own meta-types) must be a declared local `owl:Class` — parallel to the
	// domain/range check above, closing the gap that let a hand-typed
	// `core:nutzt a core:Ghost` pass validation untouched before individuals became a first-class,
	// canvas-created capability.
	// relation-assertions Story 003: `RDF.Statement` is an external RDF-vocabulary meta-type, like
	// the OWL/SHACL ones above — a reified relation's `<stmt> a rdf:Statement` triple must not be
	// held to the "declared local owl:Class" bar the loop below applies to individuals.
	const recognizedTypeObjects = new Set<string>([
		OWL.Class,
		OWL.DatatypeProperty,
		OWL.ObjectProperty,
		SH.NodeShape,
		RDF.Statement
	]);
	for (const q of quads) {
		if (q.predicate.value !== RDF.type || recognizedTypeObjects.has(q.object.value)) continue;
		if (!declaredClasses.has(q.object.value)) {
			issues.push({
				layer: 'structural',
				message: `<${q.subject.value}> a <${q.object.value}>, which is not declared as owl:Class`
			});
		}
	}

	const rangesByProperty = new Map<string, Set<string>>();
	for (const q of quads) {
		if (q.predicate.value !== RDFS.range) continue;
		const set = rangesByProperty.get(q.subject.value) ?? new Set<string>();
		set.add(q.object.value);
		rangesByProperty.set(q.subject.value, set);
	}
	for (const [propIri, ranges] of rangesByProperty) {
		if (ranges.size > 1) {
			issues.push({
				layer: 'structural',
				message: `<${propIri}> has conflicting rdfs:range declarations: ${[...ranges].map((r) => `<${r}>`).join(', ')}`
			});
		}
	}

	// Backstage-mapping Story 005: a `backstageKind`'d class should also be `rdfs:subClassOf` the
	// configured catalog marker class for the provenance report/catalog generation to have anything
	// to say about it — per `research.md`, not enforced by the model, so this is a non-blocking
	// warning rather than joining the hard-block checks above. Skipped entirely when no marker class
	// is configured (Sprint 5 Story 014) — nothing to check against yet.
	if (authoritativeEntityClassIri !== null) {
		const subClassOfEdges = new Map<string, string[]>();
		for (const q of quads) {
			if (q.predicate.value !== RDFS.subClassOf) continue;
			const list = subClassOfEdges.get(q.subject.value) ?? [];
			list.push(q.object.value);
			subClassOfEdges.set(q.subject.value, list);
		}
		function hasAuthoritativeAncestry(classIriValue: string, seen: Set<string>): boolean {
			if (seen.has(classIriValue)) return false;
			seen.add(classIriValue);
			for (const parent of subClassOfEdges.get(classIriValue) ?? []) {
				if (parent === authoritativeEntityClassIri || hasAuthoritativeAncestry(parent, seen)) return true;
			}
			return false;
		}
		for (const q of quads) {
			if (q.predicate.value !== BACKSTAGE_KIND_PREDICATE_IRI) continue;
			if (!hasAuthoritativeAncestry(q.subject.value, new Set())) {
				issues.push({
					layer: 'structural',
					severity: 'warning',
					message: `<${q.subject.value}> has a backstageKind annotation but is not rdfs:subClassOf the configured catalog marker class`
				});
			}
		}
	}

	return issues;
}

/**
 * Catalog-specific structural check (data-catalog Story 010) — syntax/structural tier, same as
 * `checkStructural` above, not a SHACL shapes validation (this app's GraphDB repository is
 * deliberately non-SHACL-enabled). For every `dcat:Dataset` in the draft, verifies the mandatory
 * fields (`dct:title`/`dct:identifier`/`dct:conformsTo`, always inferable but hand-deletable;
 * `dct:publisher`/`dct:license`, uninferable) carry a non-empty value, and that a
 * `dcat:Distribution` is present with non-empty `dct:format`/`dcat:mediaType`/`dcat:accessURL`.
 * `dcat:theme`/`dcat:keyword` are intentionally never checked — no taxonomy source exists to
 * require them from (Story 008's generation engine doc comment). An "empty" value is a literal
 * whose lexical form is `""`, matching the generator's own placeholder convention.
 */
export function checkCatalogStructural(quads: Quad[]): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	function hasNonEmptyValue(subject: string, predicate: string): boolean {
		return quads.some(
			(q) => q.subject.value === subject && q.predicate.value === predicate && q.object.value !== ''
		);
	}

	const datasetSubjects = [
		...new Set(quads.filter((q) => isRdfType(q, DCAT.Dataset)).map((q) => q.subject.value))
	];

	const requiredDatasetFields: [string, string][] = [
		[DCT.title, 'dct:title'],
		[DCT.identifier, 'dct:identifier'],
		[DCT.conformsTo, 'dct:conformsTo'],
		[DCT.publisher, 'dct:publisher'],
		[DCT.license, 'dct:license']
	];

	for (const dataset of datasetSubjects) {
		for (const [predicate, label] of requiredDatasetFields) {
			if (!hasNonEmptyValue(dataset, predicate)) {
				issues.push({
					layer: 'structural',
					message: `<${dataset}> is missing a non-empty ${label}`
				});
			}
		}

		const distributionIris = quads
			.filter((q) => q.subject.value === dataset && q.predicate.value === DCAT.distribution)
			.map((q) => q.object.value);
		if (distributionIris.length === 0) {
			issues.push({
				layer: 'structural',
				message: `<${dataset}> is missing a dcat:Distribution`
			});
			continue;
		}

		const requiredDistributionFields: [string, string][] = [
			[DCT.format, 'dct:format'],
			[DCAT.mediaType, 'dcat:mediaType'],
			[DCAT.accessURL, 'dcat:accessURL']
		];
		for (const distribution of distributionIris) {
			for (const [predicate, label] of requiredDistributionFields) {
				if (!hasNonEmptyValue(distribution, predicate)) {
					issues.push({
						layer: 'structural',
						message: `<${distribution}> (distribution of <${dataset}>) is missing a non-empty ${label}`
					});
				}
			}
		}
	}

	return issues;
}
