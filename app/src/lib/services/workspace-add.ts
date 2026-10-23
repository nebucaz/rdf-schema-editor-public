export type AddedElementOutcome = 'visible' | 'missing-node' | 'namespace-hidden';

/**
 * Classifies what happens on the canvas after an existing element joins the active Workspace
 * (`handleAddElementToWorkspace`): a canvas node must already exist for it (otherwise the schema has
 * to be re-fetched and the canvas rebuilt, since `applyVisibilityFilters` only un-hides existing
 * nodes), and a node in a hidden namespace stays hidden regardless of membership.
 */
export function classifyAddedElement(input: {
	hasNode: boolean;
	namespace: string | undefined;
	hiddenNamespaces: Set<string>;
}): AddedElementOutcome {
	if (!input.hasNode) return 'missing-node';
	if (input.namespace !== undefined && input.hiddenNamespaces.has(input.namespace)) return 'namespace-hidden';
	return 'visible';
}
