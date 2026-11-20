/**
 * Business units: the groups that hold authority over a concept or a namespace. A unit is a node of class
 * `rse:BusinessUnit` in the core vocabulary graph with an `rdfs:label`; a concept points to it with `rse:authority`.
 * Concepts written before this existed keep a plain text authority, shown as before and replaced only when someone
 * picks or types another authority.
 */

export interface BusinessUnit {
	iri: string;
	label: string;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** The unit whose whole name equals `name` (case and extra spaces ignored). */
export function findBusinessUnit(units: BusinessUnit[], name: string): BusinessUnit | undefined {
	const wanted = norm(name);
	return wanted ? units.find((u) => norm(u.label) === wanted) : undefined;
}

/** Existing units whose name contains the typed text; names that start with it come first. */
export function suggestBusinessUnits(units: BusinessUnit[], typed: string, limit = 6): BusinessUnit[] {
	const wanted = norm(typed);
	if (!wanted) return [];
	const hits = units.filter((u) => norm(u.label).includes(wanted));
	const starts = (u: BusinessUnit) => (norm(u.label).startsWith(wanted) ? 0 : 1);
	return hits.sort((a, b) => starts(a) - starts(b) || a.label.localeCompare(b.label)).slice(0, limit);
}

export interface AuthorityValue {
	/** The name to show and to export. */
	authority: string;
	/** The unit it links to. */
	authorityIri?: string;
	/** True when the name is new and the store has to create its unit with the save. */
	authorityCreate?: boolean;
}

/** What a typed or picked authority means. `legacy` is the plain text the concept already had, if any. */
export function resolveAuthorityInput(input: { text: string; iri: string; units: BusinessUnit[]; legacy: string }): AuthorityValue {
	const text = input.text.trim().replace(/\s+/g, ' ');
	if (!text) return { authority: '' };
	const picked = input.iri ? input.units.find((u) => u.iri === input.iri) : undefined;
	if (picked && norm(picked.label) === norm(text)) return { authority: picked.label, authorityIri: picked.iri };
	const existing = findBusinessUnit(input.units, text);
	if (existing) return { authority: existing.label, authorityIri: existing.iri };
	if (!input.iri && norm(input.legacy) === norm(text)) return { authority: input.legacy.trim() };
	return { authority: text, authorityCreate: true };
}
