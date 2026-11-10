/**
 * Gates for the link between classes and vocabulary concepts (ontology-pipeline STORY-327; book p. 198).
 * They need the concepts, so they report nothing unless `GateOptions.concepts` was supplied, which is how
 * a repository without a vocabulary stays quiet. Findings are about the class and link to it.
 */
import { SCHEMA_NAMESPACE } from '#lib/config.js';
import { conceptTitle, type Concept } from '../skos-concept';
import type { FetchedClass, FetchedSchema } from '../sparql-connector';
import type { Gate, GateFinding, GateSeverity } from './types';

const finding = (gateId: string, severity: GateSeverity, c: FetchedClass, message: string): GateFinding => ({
	gateId,
	stage: 'ontology',
	severity,
	elementIri: c.iri,
	message
});

/** The classes the model owns: the application's own bookkeeping classes need no concept. */
export const modelClasses = (schema: FetchedSchema) => schema.classes.filter((c) => !c.iri.startsWith(SCHEMA_NAMESPACE));

const sameText = (a: string, b: string) => {
	const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
	return norm(a) === norm(b);
};

export const classWithoutConceptOrCommentGate: Gate = {
	id: 'class-without-concept-or-comment',
	stage: 'ontology',
	run: (schema, options) =>
		!options.concepts
			? []
			: modelClasses(schema)
					.filter((c) => !c.definedByConcept && !c.comment?.trim())
					.map((c) =>
						finding('class-without-concept-or-comment', 'warning', c, `Class "${c.label}" has neither a vocabulary concept nor a description.`)
					)
};

export const classWithoutConceptGate: Gate = {
	id: 'class-without-concept',
	stage: 'ontology',
	run: (schema, options) =>
		!options.concepts
			? []
			: modelClasses(schema)
					.filter((c) => !c.definedByConcept && c.comment?.trim())
					.map((c) => finding('class-without-concept', 'info', c, `Class "${c.label}" is described but has no vocabulary concept.`))
};

export const definitionDriftGate: Gate = {
	id: 'definition-drift',
	stage: 'ontology',
	run: (schema, options) => {
		const byIri = new Map((options.concepts ?? []).map((c) => [c.iri, c]));
		return modelClasses(schema).flatMap((c) => {
			const concept = c.definedByConcept ? byIri.get(c.definedByConcept) : undefined;
			if (!concept || !concept.definition.trim() || !c.comment?.trim() || sameText(c.comment, concept.definition)) return [];
			return [
				finding('definition-drift', 'warning', c, `The description of "${c.label}" differs from the definition of its concept "${conceptTitle(concept)}".`)
			];
		});
	}
};

export const linkToRetiredConceptGate: Gate = {
	id: 'link-to-retired-concept',
	stage: 'ontology',
	run: (schema, options) => {
		const byIri = new Map((options.concepts ?? []).map((c) => [c.iri, c]));
		return modelClasses(schema).flatMap((c) => {
			const concept = c.definedByConcept ? byIri.get(c.definedByConcept) : undefined;
			if (!concept || (concept.status !== 'deprecated' && concept.status !== 'retired')) return [];
			const replacement: Concept | undefined = concept.replacedBy ? byIri.get(concept.replacedBy) : undefined;
			const live = replacement && replacement.status !== 'deprecated' && replacement.status !== 'retired' ? replacement : undefined;
			const f = finding(
				'link-to-retired-concept',
				'warning',
				c,
				`"${c.label}" is defined by the ${concept.status} concept "${conceptTitle(concept)}"${live ? `; its replacement is "${conceptTitle(live)}".` : '.'}`
			);
			if (live) {
				f.fix = {
					kind: 'retarget-concept',
					classIri: c.iri,
					namespaceBaseIri: c.namespaceBaseIri,
					conceptIri: live.iri,
					conceptLabel: conceptTitle(live)
				};
			}
			return [f];
		});
	}
};

export const LINK_GATES: Gate[] = [
	classWithoutConceptOrCommentGate,
	classWithoutConceptGate,
	definitionDriftGate,
	linkToRetiredConceptGate
];

/** The link gates over a loaded schema and the vocabulary's concepts. */
export function runLinkGates(schema: FetchedSchema, concepts: Concept[]): GateFinding[] {
	return LINK_GATES.flatMap((gate) => gate.run(schema, { concepts }));
}
