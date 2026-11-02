/**
 * Pure derivation of the Add Entity picker's options from an already-loaded schema (loading-spinner
 * STORY-270), so opening the dialog does not refetch the whole schema. `nameableEntitiesFromSchema` is the
 * single source of truth for the schema-derived part of `SparqlConnector.fetchNameableEntities`, so both
 * paths label and deduplicate identically.
 */
import type { FetchedSchema, NameableEntity } from './sparql-connector';

/** Every class, attribute, relation and individual of `schema` as a labelled, kind-tagged entity, one per IRI. */
export function nameableEntitiesFromSchema(schema: FetchedSchema): NameableEntity[] {
	const classLabelByIri = new Map(schema.classes.map((c) => [c.iri, c.label]));
	const all: NameableEntity[] = [
		...schema.classes.map((c) => ({ iri: c.iri, label: c.label, kind: 'class' as const })),
		...schema.datatypeProperties.map((p) => ({
			iri: p.iri,
			label: classLabelByIri.has(p.domain) ? `${classLabelByIri.get(p.domain)}.${p.label}` : p.label,
			kind: 'attribute' as const
		})),
		...schema.objectProperties.map((p) => ({ iri: p.iri, label: p.label, kind: 'relation' as const })),
		...schema.individuals.map((i) => ({ iri: i.iri, label: i.label, kind: 'individual' as const }))
	];
	return all;
}

/** The elements the Add Entity dialog can place on a workspace: classes and individuals only. */
export function addableElementsFromSchema(schema: FetchedSchema): NameableEntity[] {
	return dedupeByIri(nameableEntitiesFromSchema(schema)).filter((e) => e.kind === 'class' || e.kind === 'individual');
}

/** Later entries win for a repeated IRI, in first-seen position (the `Map` semantics the connector always had). */
export function dedupeByIri(entities: NameableEntity[]): NameableEntity[] {
	return [...new Map(entities.map((e) => [e.iri, e])).values()];
}
