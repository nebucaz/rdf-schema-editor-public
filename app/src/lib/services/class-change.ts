/**
 * Pure keep/drop diff for changing an individual's class: which of its current values survive on the
 * new class and which would be lost. No GraphDB access; the caller passes the old and new class's
 * own+inherited attribute and relation fields (same merge as `mergeAncestorAttributes`).
 */

export interface ClassChangeField {
	iri: string;
	name: string;
}

export interface ClassChangePlan {
	/** Fields with a current value whose predicate also exists on the new class. */
	kept: ClassChangeField[];
	/** Fields with a current value whose predicate does not exist on the new class. */
	dropped: ClassChangeField[];
}

const hasValue = (v: string | string[] | undefined): boolean =>
	Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '';

/** `currentValues` is keyed by predicate IRI, as `fetchIndividualAttributeValues` returns it. */
export function planClassChange(
	oldFields: ClassChangeField[],
	newFields: ClassChangeField[],
	currentValues: Record<string, string | string[]>
): ClassChangePlan {
	const newIris = new Set(newFields.map((f) => f.iri));
	const plan: ClassChangePlan = { kept: [], dropped: [] };
	for (const field of oldFields) {
		if (!hasValue(currentValues[field.iri])) continue;
		(newIris.has(field.iri) ? plan.kept : plan.dropped).push(field);
	}
	return plan;
}
