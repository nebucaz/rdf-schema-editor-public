import { disambiguateOptionLabels } from '#lib/utils/relation-values.js';
import type { FetchedSchema, NameableEntity, SparqlConnector } from './sparql-connector.js';

export interface AssertionOptions {
	predicateOptions: { iri: string; label: string }[];
	objectOptions: NameableEntity[];
}

/**
 * Predicate/object typeahead options of the generic assertion editor. Both loaders receive the already
 * loaded (shared, cached) schema: without it each one falls back to the unbatched per-namespace full
 * load (~170 requests on a 14-namespace repository, spec/instance-mgmt-issue STORY-612).
 */
export async function loadAssertionOptions(
	connector: Pick<SparqlConnector, 'fetchRelationPredicateOptions' | 'fetchNameableEntities'>,
	getSchema: () => Promise<FetchedSchema>
): Promise<AssertionOptions> {
	const schema = await getSchema();
	const [predicateOptions, objectOptions] = await Promise.all([
		connector.fetchRelationPredicateOptions(schema),
		connector.fetchNameableEntities(schema)
	]);
	return { predicateOptions, objectOptions: disambiguateOptionLabels(objectOptions) };
}
