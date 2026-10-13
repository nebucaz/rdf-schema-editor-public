import type { BuilderClass, BuilderSchema } from '../services/query-builder-schema';

export interface ClassGroup {
	namespaceBaseIri: string;
	/** Namespace prefix, or the base IRI when the namespace isn't registered. */
	label: string;
	classes: BuilderClass[];
}

/** Picker data: classes grouped by owning namespace, filtered by a case-insensitive label match. */
export function groupClassesByNamespace(
	schema: BuilderSchema,
	namespaces: { baseIri: string; prefix: string }[],
	filter: string
): ClassGroup[] {
	const needle = filter.trim().toLowerCase();
	const prefixOf = new Map(namespaces.map((n) => [n.baseIri, n.prefix]));
	const byNs = new Map<string, BuilderClass[]>();
	for (const c of schema.classes.values()) {
		if (needle && !c.label.toLowerCase().includes(needle)) continue;
		if (!byNs.has(c.namespaceBaseIri)) byNs.set(c.namespaceBaseIri, []);
		byNs.get(c.namespaceBaseIri)!.push(c);
	}
	return [...byNs.entries()]
		.map(([namespaceBaseIri, classes]) => ({
			namespaceBaseIri,
			label: prefixOf.get(namespaceBaseIri) || namespaceBaseIri,
			classes: classes.sort((a, b) => a.label.localeCompare(b.label))
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** Short constraint hints shown next to a property or relationship. */
export function propertyHints(p: {
	required: boolean;
	repeatable: boolean;
	minCount?: number;
	maxCount?: number;
}): string[] {
	if (p.required) return ['required'];
	if (p.repeatable) return ['multi-valued'];
	if (p.minCount !== undefined || p.maxCount !== undefined)
		return [`${p.minCount ?? 0}..${p.maxCount ?? '*'}`];
	return [];
}

export interface ClassOption {
	iri: string;
	/** `prefix:ClassName`, so same-named classes in different namespaces stay distinguishable. */
	label: string;
}

/** Dropdown options for the class select: every class, or only those of one namespace. */
export function classOptions(
	schema: BuilderSchema,
	namespaces: { baseIri: string; prefix: string }[],
	namespaceBaseIri: string | null
): ClassOption[] {
	const prefixOf = new Map(namespaces.map((n) => [n.baseIri, n.prefix]));
	return [...schema.classes.values()]
		.filter((c) => !namespaceBaseIri || c.namespaceBaseIri === namespaceBaseIri)
		.map((c) => {
			const prefix = prefixOf.get(c.namespaceBaseIri);
			return { iri: c.iri, label: prefix ? `${prefix}:${c.label}` : c.label };
		})
		.sort((a, b) => a.label.localeCompare(b.label));
}
