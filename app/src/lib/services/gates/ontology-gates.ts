/** The first gates, all on asserted data (no reasoner), for the ontology stage (ontology-pipeline STORY-319). */
import { CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI } from '#lib/utils/iri.js';
import type { FetchedSchema } from '../sparql-connector';
import type { Gate, GateFinding } from './types';

const finding = (
	gateId: string,
	severity: GateFinding['severity'],
	elementIri: string,
	message: string
): GateFinding => ({ gateId, stage: 'ontology', severity, elementIri, message });

/** Namespaces whose properties a shape may use without this app declaring them. */
const BUILT_IN_PATH_NAMESPACES = [
	'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
	'http://www.w3.org/2000/01/rdf-schema#',
	'http://www.w3.org/2002/07/owl#',
	'http://www.w3.org/2001/XMLSchema#',
	'http://www.w3.org/ns/shacl#'
];

const labelOf = (schema: FetchedSchema, iri: string): string =>
	schema.classes.find((c) => c.iri === iri)?.label ?? iri.split(/[#/]/).pop() ?? iri;

export const classWithoutCommentGate: Gate = {
	id: 'class-without-comment',
	stage: 'ontology',
	run: (schema) =>
		schema.classes
			.filter((c) => !c.comment?.trim())
			.map((c) => finding('class-without-comment', 'warning', c.iri, `Class "${c.label}" has no description (rdfs:comment).`))
};

export const classWithoutParentGate: Gate = {
	id: 'class-without-parent',
	stage: 'ontology',
	run: (schema) => {
		const subs = new Set(schema.subClassOf.map((s) => s.sub));
		return schema.classes
			.filter((c) => !subs.has(c.iri))
			.map((c) => finding('class-without-parent', 'info', c.iri, `Class "${c.label}" has no parent class.`));
	}
};

export const classWithoutShapeGate: Gate = {
	id: 'class-without-shape',
	stage: 'ontology',
	run: (schema) => {
		if (!schema.shapes) return [];
		const targeted = new Set(schema.shapes.map((s) => s.targetClassIri));
		return schema.classes
			.filter((c) => !targeted.has(c.iri))
			.map((c) => finding('class-without-shape', 'warning', c.iri, `Class "${c.label}" has no SHACL shape.`));
	}
};

export const shapePathUndeclaredGate: Gate = {
	id: 'shape-path-undeclared',
	stage: 'ontology',
	run: (schema) => {
		if (!schema.shapes) return [];
		const declared = new Set(
			[...schema.datatypeProperties, ...schema.objectProperties].map((p) => p.iri)
		);
		const out: GateFinding[] = [];
		for (const shape of schema.shapes) {
			for (const path of shape.paths) {
				if (declared.has(path) || path === CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI || BUILT_IN_PATH_NAMESPACES.some((ns) => path.startsWith(ns))) continue;
				const name = path.split(/[#/]/).pop() ?? path;
				const target = shape.targetClassIri ? ` of "${labelOf(schema, shape.targetClassIri)}"` : '';
				out.push(
					finding('shape-path-undeclared', 'warning', shape.iri, `The shape${target} constrains "${name}", which is not a declared property.`)
				);
			}
		}
		return out;
	}
};

export const individualOutsideDomainGate: Gate = {
	id: 'individual-outside-domain',
	stage: 'ontology',
	run: (schema) => {
		const domains = new Map<string, Set<string>>();
		for (const p of [...schema.datatypeProperties, ...schema.objectProperties]) {
			const set = domains.get(p.iri) ?? new Set<string>();
			set.add(p.domain);
			domains.set(p.iri, set);
		}

		const supers = new Map<string, string[]>();
		for (const { sub, super: sup } of schema.subClassOf) supers.set(sub, [...(supers.get(sub) ?? []), sup]);
		const closure = (start: string): Set<string> => {
			const seen = new Set<string>();
			const todo = [start];
			while (todo.length > 0) {
				const next = todo.pop()!;
				if (seen.has(next)) continue;
				seen.add(next);
				todo.push(...(supers.get(next) ?? []));
			}
			return seen;
		};

		const types = new Map<string, Set<string>>();
		for (const i of schema.individuals) types.set(i.iri, (types.get(i.iri) ?? new Set()).add(i.classIri));
		for (const u of schema.untypedIndividuals ?? []) if (!types.has(u.iri)) types.set(u.iri, new Set());

		const subjectFacts = [
			...schema.individualClassRelations.map((r) => ({ subject: r.individualIri, predicate: r.predicateIri, name: r.name })),
			...schema.individualIndividualRelations.map((r) => ({ subject: r.individualIri, predicate: r.predicateIri, name: r.name }))
		];

		const out: GateFinding[] = [];
		const seen = new Set<string>();
		for (const { subject, predicate, name } of subjectFacts) {
			const wanted = domains.get(predicate);
			const own = types.get(subject);
			if (!wanted || !own) continue;
			const key = `${subject}\u0000${predicate}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const fits = [...own].some((t) => [...closure(t)].some((c) => wanted.has(c)));
			if (fits) continue;
			const wantedNames = [...wanted].map((d) => `"${labelOf(schema, d)}"`).join(' or ');
			out.push(
				finding(
					'individual-outside-domain',
					'warning',
					subject,
					`"${subject.split(/[#/]/).pop()}" uses "${name}" but is not an instance of ${wantedNames}.`
				)
			);
		}
		return out;
	}
};

export const ONTOLOGY_GATES: Gate[] = [
	classWithoutCommentGate,
	classWithoutParentGate,
	classWithoutShapeGate,
	shapePathUndeclaredGate,
	individualOutsideDomainGate
];
