import { sparqlConnector } from '#lib/services/sparql-connector.js';
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
 * Optional host side effects (spec/unify-instance-forms, STORY-002). The shared create/edit flow knows
 * nothing about the canvas; a host that needs more (join the workspace, draw/remove an edge, refresh a
 * label) passes hooks. Each runs after its write succeeded, in write order, and a hook that throws or
 * rejects never undoes the write nor stops the following ones.
 */
export interface IdentityMutationHooks {
	onCreated?(iri: string, label: string): void | Promise<void>;
	onRenamed?(iri: string, label: string): void | Promise<void>;
	onRelationAdded?(subjectIri: string, predicateIri: string, objectIri: string, predicateLabel: string): void | Promise<void>;
	onRelationRemoved?(subjectIri: string, predicateIri: string, objectIri: string): void | Promise<void>;
}

async function runHook(fn: (() => void | Promise<void>) | undefined): Promise<void> {
	if (!fn) return;
	try {
		await fn();
	} catch {
		// The write already happened; a host hook failure must not look like a failed edit.
	}
}

/** Writes one relation triple (immediate add from the picker) and fires `onRelationAdded`. */
export async function addRelation(
	subjectIri: string,
	predicateLabel: string,
	objectIri: string,
	connector: IdentityMutationConnector = sparqlConnector,
	hooks: IdentityMutationHooks = {}
): Promise<{ predicateIri: string }> {
	const { predicateIri } = await connector.insertAssertion(subjectIri, predicateLabel, objectIri);
	await runHook(() => hooks.onRelationAdded?.(subjectIri, predicateIri, objectIri, predicateLabel));
	return { predicateIri };
}

/** Deletes one relation triple (immediate remove) and fires `onRelationRemoved`. */
export async function removeRelation(
	subjectIri: string,
	predicateIri: string,
	objectIri: string,
	connector: IdentityMutationConnector = sparqlConnector,
	hooks: IdentityMutationHooks = {}
): Promise<void> {
	await connector.deleteAssertion(subjectIri, predicateIri, objectIri);
	await runHook(() => hooks.onRelationRemoved?.(subjectIri, predicateIri, objectIri));
}

/** Applies a `RelationValueSubmission[]` diff through `addRelation`/`removeRelation`, so hooks fire per triple. */
async function applyRelationDiff(
	connector: IdentityMutationConnector,
	individualIri: string,
	submissions: RelationValueSubmission[],
	hooks: IdentityMutationHooks
): Promise<void> {
	for (const submission of submissions) {
		for (const objectIri of submission.added) {
			await addRelation(individualIri, submission.predicateLabel, objectIri, connector, hooks);
		}
		for (const objectIri of submission.removed) {
			await removeRelation(individualIri, submission.predicateIri, objectIri, connector, hooks);
		}
	}
}

/** Creates an individual and applies its attribute/relation submissions; workspace-agnostic (hosts use `onCreated`). */
export async function createIdentity(
	classIri: string,
	label: string,
	namespaceBaseIri: string,
	attributeSubmissions: AttributeValueSubmission[] = [],
	identifier?: string,
	relationSubmissions: RelationValueSubmission[] = [],
	connector: IdentityMutationConnector = sparqlConnector,
	hooks: IdentityMutationHooks = {}
): Promise<{ iri: string }> {
	const { iri } = await connector.insertIndividual(classIri, label, namespaceBaseIri, identifier);
	await runHook(() => hooks.onCreated?.(iri, label));
	if (attributeSubmissions.length > 0) {
		await connector.applyAttributeSubmissions(iri, attributeSubmissions);
	}
	if (relationSubmissions.length > 0) {
		await applyRelationDiff(connector, iri, relationSubmissions, hooks);
	}
	return { iri };
}

/** Renames (only when the label changed), applies attribute submissions, then the relation diff. */
export async function editIdentity(
	iri: string,
	label: string,
	originalLabel: string,
	attributeSubmissions: AttributeValueSubmission[] = [],
	relationSubmissions: RelationValueSubmission[] = [],
	connector: IdentityMutationConnector = sparqlConnector,
	hooks: IdentityMutationHooks = {}
): Promise<void> {
	if (label !== originalLabel) {
		await connector.renameIndividual(iri, label);
		await runHook(() => hooks.onRenamed?.(iri, label));
	}
	if (attributeSubmissions.length > 0) {
		await connector.applyAttributeSubmissions(iri, attributeSubmissions);
	}
	if (relationSubmissions.length > 0) {
		await applyRelationDiff(connector, iri, relationSubmissions, hooks);
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
