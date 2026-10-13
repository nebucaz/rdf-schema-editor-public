/**
 * Test support for the SOC sample (`examples/soc/*.ttl`, `spec/spl-examples`): loads the files from
 * disk and turns parsed quads into the `FetchedSchema` the query builder consumes, so specs can run
 * `buildBuilderSchema`/`compileQuery`/`printSplPipeline` against the sample with no GraphDB.
 * Test-only — nothing in the app imports this module.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OWL, RDF, RDFS, SH, SH_NS, parseTurtle, type Quad } from './turtle';
import type {
	FetchedClass,
	FetchedObjectProperty,
	FetchedProperty,
	FetchedSchema
} from './sparql-connector';

export const SOC_BASE_IRI = 'http://ld.pageagent.com/example/soc';
export const SOC_SCHEMA_NS = `${SOC_BASE_IRI}/schema#`;
export const SOC_DATA_NS = `${SOC_BASE_IRI}#`;

export function loadSocFile(name: string): string {
	return readFileSync(fileURLToPath(new URL(`../../../../examples/soc/${name}`, import.meta.url)), 'utf8');
}

/** Schema, shapes and data merged into one quad list, as a full import would leave the namespace. */
export function loadSocQuads(): Quad[] {
	return ['soc-schema.ttl', 'soc-shapes.ttl', 'soc-data.ttl'].flatMap((f) => parseTurtle(loadSocFile(f)));
}

const objectsOf = (quads: Quad[], subject: string, predicate: string) =>
	quads.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((q) => q.object.value);
const subjectsOfType = (quads: Quad[], type: string) => [
	...new Set(quads.filter((q) => q.predicate.value === RDF.type && q.object.value === type).map((q) => q.subject.value))
];

/**
 * Chain-completeness problems: every event is `recordedIn` exactly one logfile, every logfile is
 * `hostedOn` exactly one server, every alert is `triggeredBy` at least one event. Empty when intact.
 */
export function chainIssues(quads: Quad[]): string[] {
	const p = (n: string) => SOC_SCHEMA_NS + n;
	const issues: string[] = [];
	for (const e of subjectsOfType(quads, p('AuthenticationEvent'))) {
		const files = objectsOf(quads, e, p('recordedIn'));
		if (files.length !== 1) issues.push(`${e}: expected one recordedIn, found ${files.length}`);
	}
	for (const f of subjectsOfType(quads, p('LogFile'))) {
		const hosts = objectsOf(quads, f, p('hostedOn'));
		if (hosts.length !== 1) issues.push(`${f}: expected one hostedOn, found ${hosts.length}`);
	}
	for (const a of subjectsOfType(quads, p('Alert'))) {
		if (objectsOf(quads, a, p('triggeredBy')).length === 0) issues.push(`${a}: no triggeredBy event`);
	}
	return issues;
}

/**
 * Builds the `FetchedSchema` that `fetchFullSchema` would return for the merged SOC quads: cardinality is
 * joined to a property by `sh:path` alone (exactly like the connector), `required` = `minCount >= 1`,
 * `repeatable` = no `maxCount`. Individuals are every labelled subject typed with a declared class.
 */
export function buildSocFetchedSchema(quads: Quad[]): FetchedSchema {
	const first = (s: string, pr: string) => objectsOf(quads, s, pr)[0];
	const classIris = subjectsOfType(quads, OWL.Class);
	const classSet = new Set(classIris);
	const classes: FetchedClass[] = classIris.map((iri) => ({
		iri,
		label: first(iri, RDFS.label) ?? iri,
		comment: first(iri, RDFS.comment) ?? null,
		namespaceBaseIri: SOC_BASE_IRI
	}));

	const constraintByPath = new Map<string, { min?: number; max?: number }>();
	for (const ps of quads.filter((q) => q.predicate.value === SH.property).map((q) => q.object.value)) {
		const path = first(ps, SH.path);
		if (!path) continue;
		const min = first(ps, `${SH_NS}minCount`);
		const max = first(ps, `${SH_NS}maxCount`);
		constraintByPath.set(path, {
			min: min === undefined ? undefined : parseInt(min, 10),
			max: max === undefined ? undefined : parseInt(max, 10)
		});
	}
	const property = (iri: string): FetchedProperty => {
		const c = constraintByPath.get(iri);
		return {
			iri,
			label: first(iri, RDFS.label) ?? iri,
			domain: first(iri, RDFS.domain) ?? '',
			range: first(iri, RDFS.range) ?? '',
			namespaceBaseIri: SOC_BASE_IRI,
			required: (c?.min ?? 0) >= 1,
			repeatable: c?.max === undefined,
			minCount: c?.min,
			maxCount: c?.max,
			requiredForSubclasses: false
		};
	};

	const individuals = [
		...new Set(
			quads
				.filter((q) => q.predicate.value === RDF.type && classSet.has(q.object.value))
				.map((q) => q.subject.value)
		)
	].map((iri) => ({
		iri,
		label: first(iri, RDFS.label) ?? iri,
		classIri: objectsOf(quads, iri, RDF.type).find((t) => classSet.has(t))!,
		namespaceBaseIri: SOC_BASE_IRI,
		syncSource: null,
		syncStatus: null
	}));

	return {
		classes,
		datatypeProperties: subjectsOfType(quads, OWL.DatatypeProperty).map(property),
		objectProperties: subjectsOfType(quads, OWL.ObjectProperty).map(
			(iri): FetchedObjectProperty => ({ ...property(iri), relationKind: 'specific' })
		),
		subClassOf: [],
		individuals,
		individualClassRelations: [],
		individualIndividualRelations: [],
		labelRequiredClassIris: [],
		shapeInConstraints: []
	};
}
