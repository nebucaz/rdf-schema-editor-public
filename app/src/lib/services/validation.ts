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
import { isRdfType, OWL, RDF, RDFS, SH, type Quad } from './turtle';
import { XSD_NAMESPACE } from '$lib/utils/iri';

export interface ValidationIssue {
	layer: 'syntax' | 'shacl' | 'structural';
	message: string;
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
 */
export function checkStructural(quads: Quad[]): ValidationIssue[] {
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
	const recognizedTypeObjects = new Set<string>([OWL.Class, OWL.DatatypeProperty, OWL.ObjectProperty, SH.NodeShape]);
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

	return issues;
}
