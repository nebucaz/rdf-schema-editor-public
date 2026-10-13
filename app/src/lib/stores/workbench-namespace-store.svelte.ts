import { defaultWorkbenchNamespaces } from '$lib/utils/workbench-namespace';

interface NamespaceScopeInfo {
	baseIri: string;
	defaultHidden: boolean;
}

/**
 * The Query Workbench's own namespace selection (STORY-187). Session-level and deliberately separate
 * from `workbenchActions.hiddenNamespaces` (canvas) and `validationReportFilterStore`; a saved query
 * persists its own list inside its model, loaded here with `setSelection`. `selected` is `null` until
 * the namespace list has been fetched and `ensureInitialised` has seeded the default.
 */
export class WorkbenchNamespaceStore {
	selected = $state<string[] | null>(null);

	/** Seeds the default selection the first time; later calls keep whatever the user chose. */
	ensureInitialised(namespaces: NamespaceScopeInfo[]): void {
		if (this.selected === null) this.selected = defaultWorkbenchNamespaces(namespaces);
	}

	/** Starts a new query from the default selection. */
	resetToDefault(namespaces: NamespaceScopeInfo[]): void {
		this.selected = defaultWorkbenchNamespaces(namespaces);
	}

	/** Replaces the selection, e.g. with a loaded saved query's stored list. */
	setSelection(baseIris: string[]): void {
		this.selected = [...baseIris];
	}

	toggle(baseIri: string): void {
		const current = this.selected ?? [];
		this.selected = current.includes(baseIri)
			? current.filter((b) => b !== baseIri)
			: [...current, baseIri];
	}
}

export const workbenchNamespaceStore = new WorkbenchNamespaceStore();
