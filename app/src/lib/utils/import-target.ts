/**
 * Pure helpers behind the "Import Turtle" dialog: which namespaces may receive an import, which one is
 * preselected, and which dropped files are accepted. The dialog (not the active-namespace `<select>`,
 * which only exists on the canvas route) is the single place the import target is chosen.
 */

interface TargetNamespace {
	baseIri: string;
	prefix: string;
}

/** Every registered namespace except the bookkeeping one (`excludeBaseIri`), sorted by prefix. */
export function importTargetOptions<T extends TargetNamespace>(namespaces: T[], excludeBaseIri: string): T[] {
	return namespaces
		.filter((ns) => ns.baseIri !== excludeBaseIri)
		.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/**
 * The preselected target: the active namespace when it is offered, the sole option when there is
 * only one, otherwise `null` — the user must choose, so an import can never silently fall back to
 * the default namespace.
 */
export function initialImportTarget(options: TargetNamespace[], activeNamespace: string | null): string | null {
	if (activeNamespace && options.some((o) => o.baseIri === activeNamespace)) return activeNamespace;
	return options.length === 1 ? options[0].baseIri : null;
}

export function isTurtleFileName(name: string): boolean {
	return /\.ttl$/i.test(name) && name.length > 4;
}
