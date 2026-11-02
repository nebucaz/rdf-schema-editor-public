/**
 * Pure model for "add entities from namespace" (loading-spinner STORY-271): which classes a namespace
 * offers for a workspace, and where a batch of them lands on the canvas. No GraphDB, no Svelte.
 */
import { gridPosition } from '#lib/stores/layout-store.js';
import type { FetchedSchema } from './sparql-connector';

export interface NamespaceClassRow {
	iri: string;
	label: string;
	alreadyOnWorkspace: boolean;
}

export interface PlacedClass {
	iri: string;
	x: number;
	y: number;
}

/** Classes of `namespaceBaseIri` (association classes included, external stubs excluded), by label then IRI. */
export function classesOfNamespace(
	schema: FetchedSchema,
	namespaceBaseIri: string,
	workspaceMembers: ReadonlySet<string>
): NamespaceClassRow[] {
	return schema.classes
		.filter((c) => c.namespaceBaseIri === namespaceBaseIri)
		.map((c) => ({ iri: c.iri, label: c.label, alreadyOnWorkspace: workspaceMembers.has(c.iri) }))
		.sort((a, b) => a.label.localeCompare(b.label) || a.iri.localeCompare(b.iri));
}

/** Grid positions for `iris` in order, the first at `origin` (spacing from `gridPosition`). */
export function placeClasses(iris: readonly string[], origin: { x: number; y: number }): PlacedClass[] {
	return iris.map((iri, index) => {
		const slot = gridPosition(index);
		return { iri, x: origin.x + slot.x, y: origin.y + slot.y };
	});
}
