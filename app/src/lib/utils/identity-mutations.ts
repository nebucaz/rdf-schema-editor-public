import { sparqlConnector } from '$lib/services/sparql-connector';
import type { AttributeValueSubmission } from './attribute-values';
import type { RelationValueSubmission } from './relation-values';

/**
 * The subset of `SparqlConnector` this module needs (STORY-122) — kept as a narrow structural
 * interface, mirroring `AttributeSpecLike`/`RelationFieldSpecLike`'s own rationale, so tests can pass
 * a plain mock object instead of the full connector class. Every caller (STORY-123/124) gets the real
 * `sparqlConnector` singleton for free via each function's default parameter.
 */
export interface IdentityMutationConnector {
	insertIndividual(
		classIriValue: string,
		label: string,
		namespaceBaseIri?: string,
		identifier?: string
	): Promise<{ iri: string }>;
	renameIndividual(iri: string, newLabel: string, namespaceBaseIri?: string): Promise<void>;
	applyAttributeSubmissions(iri: string, submissions: AttributeValueSubmission[]): Promise<void>;
	insertAssertion(individualIri: string, predicateLabel: string, objectIri: string): Promise<{ predicateIri: string }>;
	deleteAssertion(individualIri: string, predicateIri: string, objectIri: string): Promise<void>;
	resolveEffectiveClassNamespace(classIriValue: string): Promise<{ baseIri: string; own: boolean } | null>;
}

/**
 * Applies a `RelationValueSubmission[]` diff via the same `insertAssertion`/`deleteAssertion`
 * mechanism the canvas's own `applyRelationSubmissions` (`routes/+page.svelte:1162-1171`) uses —
 * intentionally **not** a port of that helper, since its every call goes through
 * `handleAddAssertion`/`handleDeleteAssertion`, which also draw/remove a canvas edge
 * (`addAssertionEdgeIfVisible`/`removeAssertionEdgeIfVisible`). This module has no canvas/Svelte Flow
 * awareness at all, so it calls the connector methods directly instead.
 */
async function applyRelationDiff(
	connector: IdentityMutationConnector,
	individualIri: string,
	submissions: RelationValueSubmission[]
): Promise<void> {
	for (const submission of submissions) {
		for (const objectIri of submission.added) {
			await connector.insertAssertion(individualIri, submission.predicateLabel, objectIri);
		}
		for (const objectIri of submission.removed) {
			await connector.deleteAssertion(individualIri, submission.predicateIri, objectIri);
		}
	}
}

/**
 * Non-canvas equivalent of `routes/+page.svelte`'s `handleAddMember` (research.md §3.2) — creates a
 * new individual and applies its attribute/relation submissions, deliberately **without** the
 * canvas-only `addWorkspaceMember` call (research.md §6 decision 3): identities created from the
 * Identities route never become canvas nodes.
 */
export async function createIdentity(
	classIri: string,
	label: string,
	namespaceBaseIri: string,
	attributeSubmissions: AttributeValueSubmission[] = [],
	identifier?: string,
	relationSubmissions: RelationValueSubmission[] = [],
	connector: IdentityMutationConnector = sparqlConnector
): Promise<{ iri: string }> {
	const { iri } = await connector.insertIndividual(classIri, label, namespaceBaseIri, identifier);
	if (attributeSubmissions.length > 0) {
		await connector.applyAttributeSubmissions(iri, attributeSubmissions);
	}
	if (relationSubmissions.length > 0) {
		await applyRelationDiff(connector, iri, relationSubmissions);
	}
	return { iri };
}

/**
 * Non-canvas equivalent of `routes/+page.svelte`'s `handleEditMember` — renames (only when the label
 * actually changed, unlike the canvas's own unconditional `renameIndividual` call), applies attribute
 * submissions, then the same relation diff `createIdentity` uses.
 */
export async function editIdentity(
	iri: string,
	label: string,
	originalLabel: string,
	attributeSubmissions: AttributeValueSubmission[] = [],
	relationSubmissions: RelationValueSubmission[] = [],
	connector: IdentityMutationConnector = sparqlConnector
): Promise<void> {
	if (label !== originalLabel) {
		await connector.renameIndividual(iri, label);
	}
	if (attributeSubmissions.length > 0) {
		await connector.applyAttributeSubmissions(iri, attributeSubmissions);
	}
	if (relationSubmissions.length > 0) {
		await applyRelationDiff(connector, iri, relationSubmissions);
	}
}

/**
 * Default namespace for a newly created identity (research.md §6 decision 2): the class's Concept
 * Namespace when one is declared, own or inherited (`resolveEffectiveClassNamespace`); otherwise that
 * class's own declaring namespace, looked up from the STORY-121 schema index — **never**
 * `activeNamespaceBaseIri()` or any other canvas-only "currently active namespace" concept, which has
 * no off-canvas equivalent. Must be resolved and passed into `createIdentity` explicitly: a plain
 * label-derived create relies entirely on the caller-supplied `namespaceBaseIri`, since
 * `insertIndividual`'s own Concept-Namespace override only fires when a hand-typed `identifier` is
 * also given.
 */
export async function resolveDefaultNamespace(
	classIri: string,
	classNamespaceLookup: Map<string, { namespace: string }>,
	connector: Pick<IdentityMutationConnector, 'resolveEffectiveClassNamespace'> = sparqlConnector
): Promise<string | undefined> {
	const effective = await connector.resolveEffectiveClassNamespace(classIri);
	if (effective !== null) return effective.baseIri;
	return classNamespaceLookup.get(classIri)?.namespace;
}
