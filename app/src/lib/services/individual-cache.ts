import type { FetchedIndividual, FetchedSchema } from './sparql-connector';

/**
 * Pure updaters for `FetchedSchema.individuals`, so a local individual add/remove/rename can be
 * reflected in Instances view by rebuilding the canvas from the cached schema instead of
 * re-fetching. Every function returns a new schema and never mutates its input.
 */

/** `untypedTotal` after `iri` stops being Unclassified (removed or given a class); nothing if it wasn't. */
function untypedTotalAfterLeaving(schema: FetchedSchema, iri: string): { untypedTotal?: number } {
	const wasUntyped = schema.untypedIndividuals?.some((i) => i.iri === iri);
	return wasUntyped && schema.untypedTotal !== undefined ? { untypedTotal: Math.max(0, schema.untypedTotal - 1) } : {};
}

/** Adds `individual`, replacing any existing entry with the same IRI so a repeat call is idempotent. */
export function addIndividualToSchema(schema: FetchedSchema, individual: FetchedIndividual): FetchedSchema {
	return {
		...schema,
		individuals: [...schema.individuals.filter((i) => i.iri !== individual.iri), individual]
	};
}

/** Removes the individual and every class/individual relation it is the source or target of. */
export function removeIndividualFromSchema(schema: FetchedSchema, iri: string): FetchedSchema {
	return {
		...schema,
		individuals: schema.individuals.filter((i) => i.iri !== iri),
		untypedIndividuals: schema.untypedIndividuals?.filter((i) => i.iri !== iri),
		...untypedTotalAfterLeaving(schema, iri),
		individualClassRelations: schema.individualClassRelations.filter((r) => r.individualIri !== iri),
		individualIndividualRelations: schema.individualIndividualRelations.filter(
			(r) => r.individualIri !== iri && r.targetIndividualIri !== iri
		)
	};
}

/** Relabels the individual; its IRI is minted once and never changes. */
export function renameIndividualInSchema(schema: FetchedSchema, iri: string, label: string): FetchedSchema {
	return {
		...schema,
		individuals: schema.individuals.map((i) => (i.iri === iri ? { ...i, label } : i)),
		untypedIndividuals: schema.untypedIndividuals?.map((i) => (i.iri === iri ? { ...i, label } : i))
	};
}

/**
 * Gives the individual `classIri`, moving it out of `untypedIndividuals` if it was Unclassified, and
 * drops its relations on `dropPredicateIris` (the values a class change loses).
 */
export function setIndividualClassInSchema(
	schema: FetchedSchema,
	iri: string,
	classIri: string,
	dropPredicateIris: string[] = []
): FetchedSchema {
	const drop = new Set(dropPredicateIris);
	const untyped = schema.untypedIndividuals?.find((i) => i.iri === iri);
	const typed = schema.individuals.find((i) => i.iri === iri);
	const retyped: FetchedIndividual | null = typed
		? { ...typed, classIri }
		: untyped
			? { iri, label: untyped.label, classIri, namespaceBaseIri: untyped.namespaceBaseIri, syncSource: null, syncStatus: null }
			: null;
	if (!retyped) return schema;
	return {
		...schema,
		individuals: [...schema.individuals.filter((i) => i.iri !== iri), retyped],
		untypedIndividuals: schema.untypedIndividuals?.filter((i) => i.iri !== iri),
		...untypedTotalAfterLeaving(schema, iri),
		individualClassRelations: schema.individualClassRelations.filter(
			(r) => !(r.individualIri === iri && drop.has(r.predicateIri))
		),
		individualIndividualRelations: schema.individualIndividualRelations.filter(
			(r) => !(r.individualIri === iri && drop.has(r.predicateIri))
		)
	};
}
