/**
 * Golden snapshot of the ITAM example (`spec/shacl-test` STORY-353): turns the parsed example
 * Turtle into the JSON shape of the Go `validation.ValidationSnapshot`, so the real Go engine can be
 * run over the shipped data without GraphDB. Mirrors what `LoadValidationSnapshot` assembles from
 * GraphDB: only individuals typed by a declared `owl:Class`, their non-type triples, the shapes'
 * own `sh:property` constraints with rule id, dimension and message. Test support — nothing in the
 * app imports it. `bun run shacl:golden` rewrites the committed file; a spec fails while it is stale.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OWL, RDF, RDFS, SH, SH_NS, parseTurtle, type Quad } from './turtle';

export const ITAM_GOLDEN_PATH = 'backend/testdata/golden/itam-snapshot.json';
const ITAM_DIR = fileURLToPath(new URL('../../../../examples/itam-shapes/', import.meta.url));
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const ARM_ID = 'https://lida.pnet.ch/arm/schema#id';
const ARM_DIMENSION = 'https://lida.pnet.ch/arm/schema#qualityDimension';

export interface GoldenConstraint {
	shapeIri: string;
	ruleId: string;
	qualityDimension: string;
	message: string;
	path: string;
	minCount?: number;
	maxCount?: number;
	datatype?: string;
	pattern?: string;
	flags?: string;
	minLength?: number;
	targetClasses?: string[];
}
export interface GoldenValue {
	predicate: string;
	isIri: boolean;
	isBlank: boolean;
	value: string;
	datatype: string;
}
export interface GoldenSparqlConstraint {
	shapeIri: string;
	targetClass: string;
	select: string;
	message: string;
	ruleId: string;
	qualityDimension: string;
}
export interface GoldenSnapshot {
	subClassOf: Record<string, string[]>;
	ownConstraints: Record<string, GoldenConstraint[]>;
	individualTypes: Record<string, string[]>;
	individualValues: Record<string, GoldenValue[]>;
	sparqlConstraints: GoldenSparqlConstraint[];
}

export function loadItamQuads(): Quad[] {
	const shapeFiles = readdirSync(ITAM_DIR).filter((f) => /^AC-.*\.ttl$/.test(f)).sort();
	return ['itam-schema.ttl', ...shapeFiles, 'itam-data.ttl'].flatMap((f) =>
		parseTurtle(readFileSync(ITAM_DIR + f, 'utf8'))
	);
}

/** `sh:message` preference shared with the Go `pickMessage`: German, then untagged, then any. */
function pickMessage(messages: { language: string; value: string }[]): string {
	const pick = (ok: (m: { language: string }) => boolean) => messages.find(ok)?.value;
	return pick((m) => m.language.toLowerCase() === 'de') ?? pick((m) => m.language === '') ?? messages[0]?.value ?? '';
}

export function buildValidationSnapshot(quads: Quad[]): GoldenSnapshot {
	const objects = (s: string, p: string) =>
		quads.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object);
	const first = (s: string, p: string) => objects(s, p)[0]?.value;
	const num = (v: string | undefined) => (v === undefined ? undefined : Number.parseInt(v, 10));

	const declaredClasses = new Set(
		quads.filter((q) => q.predicate.value === RDF.type && q.object.value === OWL.Class).map((q) => q.subject.value)
	);

	const subClassOf: Record<string, string[]> = {};
	for (const q of quads.filter((q) => q.predicate.value === RDFS.subClassOf)) {
		(subClassOf[q.subject.value] ??= []).push(q.object.value);
	}

	const ownConstraints: Record<string, GoldenConstraint[]> = {};
	const shapes = quads.filter((q) => q.predicate.value === RDF.type && q.object.value === SH.NodeShape).map((q) => q.subject.value);
	for (const shape of shapes.sort()) {
		for (const cls of objects(shape, SH.targetClass)) {
			for (const ps of objects(shape, SH.property)) {
				const c: GoldenConstraint = {
					shapeIri: shape,
					ruleId: first(shape, ARM_ID) ?? '',
					qualityDimension: first(shape, ARM_DIMENSION) ?? '',
					message: pickMessage(
						objects(ps.value, `${SH_NS}message`).map((m) => ({
							language: (m as { language?: string }).language ?? '',
							value: m.value
						}))
					),
					path: first(ps.value, SH.path)!
				};
				const set = <K extends keyof GoldenConstraint>(k: K, v: GoldenConstraint[K] | undefined) => {
					if (v !== undefined) c[k] = v;
				};
				set('minCount', num(first(ps.value, `${SH_NS}minCount`)));
				set('maxCount', num(first(ps.value, `${SH_NS}maxCount`)));
				set('datatype', first(ps.value, `${SH_NS}datatype`));
				set('pattern', first(ps.value, `${SH_NS}pattern`));
				set('flags', first(ps.value, `${SH_NS}flags`));
				set('minLength', num(first(ps.value, `${SH_NS}minLength`)));
				const targets = objects(ps.value, `${SH_NS}class`).map((t) => t.value);
				if (targets.length) c.targetClasses = targets;
				(ownConstraints[cls.value] ??= []).push(c);
			}
		}
	}

	const sparqlConstraints: GoldenSparqlConstraint[] = [];
	for (const shape of shapes) {
		for (const targetClass of objects(shape, SH.targetClass)) {
			for (const sc of objects(shape, `${SH_NS}sparql`)) {
				sparqlConstraints.push({
					shapeIri: shape,
					targetClass: targetClass.value,
					select: first(sc.value, `${SH_NS}select`) ?? '',
					message: pickMessage(
						objects(sc.value, `${SH_NS}message`).map((m) => ({
							language: (m as { language?: string }).language ?? '',
							value: m.value
						}))
					),
					ruleId: first(shape, ARM_ID) ?? '',
					qualityDimension: first(shape, ARM_DIMENSION) ?? ''
				});
			}
		}
	}
	sparqlConstraints.sort((a, b) => a.shapeIri.localeCompare(b.shapeIri));

	const individualTypes: Record<string, string[]> = {};
	for (const q of quads.filter((q) => q.predicate.value === RDF.type && declaredClasses.has(q.object.value) && !declaredClasses.has(q.subject.value))) {
		(individualTypes[q.subject.value] ??= []).push(q.object.value);
	}
	const individualValues: Record<string, GoldenValue[]> = {};
	for (const individual of Object.keys(individualTypes)) {
		individualValues[individual] = quads
			.filter((q) => q.subject.value === individual && q.predicate.value !== RDF.type)
			.map((q) => {
				const isIri = q.object.termType === 'NamedNode';
				return {
					predicate: q.predicate.value,
					isIri,
					isBlank: q.object.termType === 'BlankNode',
					value: q.object.value,
					datatype: q.object.termType === 'Literal' ? ((q.object as { datatype?: { value: string } }).datatype?.value ?? XSD_STRING) : ''
				};
			});
	}

	const sorted = <T>(o: Record<string, T[]>, key: (v: T) => string): Record<string, T[]> =>
		Object.fromEntries(
			Object.keys(o).sort().map((k) => [k, [...o[k]].sort((a, b) => key(a).localeCompare(key(b)))])
		);
	return {
		subClassOf: sorted(subClassOf, (v) => String(v)),
		ownConstraints: sorted(ownConstraints, (c) => `${c.path}|${c.shapeIri}`),
		individualTypes: sorted(individualTypes, (v) => String(v)),
		individualValues: sorted(individualValues, (v) => `${v.predicate}|${v.value}`),
		sparqlConstraints
	};
}

export const serializeGolden = (snapshot: GoldenSnapshot) => JSON.stringify(snapshot, null, '\t') + '\n';
