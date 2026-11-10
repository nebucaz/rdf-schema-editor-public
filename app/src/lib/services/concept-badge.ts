/** Whether a canvas class shows the "no concept" badge (ontology-pipeline STORY-325). */
export function showNoConceptBadge(input: {
	/** The user's toggle. */
	enabled: boolean;
	/** A namespace is marked as the vocabulary namespace; without one there is nothing to link to. */
	vocabularyExists: boolean;
	definedByConcept: string | undefined;
}): boolean {
	return input.enabled && input.vocabularyExists && !input.definedByConcept;
}
