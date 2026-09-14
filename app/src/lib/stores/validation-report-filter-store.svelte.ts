/**
 * Namespace visibility filter for the `/validation` report — the same `NamespaceFilter.svelte`
 * component the canvas header already uses, but wired to its own state instead of
 * `workbenchActions.hiddenNamespaces` (a canvas-only concept, and nothing on `/validation` mounts
 * the canvas). A `.svelte.ts` reactive singleton, like `namespace-store.svelte.ts`/
 * `workbench-actions.svelte.ts`, so `+layout.svelte`'s header (which renders `NamespaceFilter`) and
 * `ValidationReportView.svelte` (which reads it to filter rendered violations) can share state
 * without a route param or Svelte context. Per the validation plan's Decision 4 ("transient only"),
 * this isn't `localStorage`-backed — it resets on reload like the rest of the report.
 */
function createValidationReportFilterStore() {
	let hiddenNamespaces = $state<Set<string>>(new Set());

	return {
		get hiddenNamespaces() {
			return hiddenNamespaces;
		},
		toggle(baseIri: string) {
			const next = new Set(hiddenNamespaces);
			if (next.has(baseIri)) {
				next.delete(baseIri);
			} else {
				next.add(baseIri);
			}
			hiddenNamespaces = next;
		}
	};
}

export const validationReportFilterStore = createValidationReportFilterStore();
