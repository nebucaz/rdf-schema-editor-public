/** The subset of `CanvasRelationFieldSpec` (`services/canvas-model.ts`) this module needs — kept as a
 *  structural type rather than importing that one, mirroring `AttributeSpecLike`'s own rationale
 *  (`attribute-values.ts`): a plain, GraphDB/canvas-free utility. */
export interface RelationFieldSpecLike {
	iri: string;
	name: string;
	required: boolean;
	repeatable: boolean;
}

/** One candidate target individual for a relation field's typeahead — `SparqlConnector
 *  .fetchIndividualsOfClass`'s own return shape, scoped to the relation's `targetClassIri`. `label`
 *  is the exact typeahead/datalist display text the caller built (e.g. `"871912 (ssi)"`, the raw
 *  `rdfs:label`/local name plus a namespace-prefix suffix) — resolution (`resolveRelationTargetIri`)
 *  matches against this text as-is, so a caller that wants two same-labeled individuals from
 *  different namespaces to stay distinguishable and separately selectable must bake that
 *  disambiguation into `label` itself before handing options here, not rely on `iri` alone. */
export interface RelationTargetOption {
	iri: string;
	label: string;
}

/** One relation field's live form value: the *typed label text* of the selected target(s) — a single
 *  string for `repeatable: false`, an array of row strings for `repeatable: true` — mirroring
 *  `AttributeFormValues`'s shape exactly. Text, not an IRI, because the input is a plain
 *  `<input list=...>` typeahead (the same pattern the existing Assertions object picker already uses,
 *  STORY-114's confirmed "reuse existing mechanism" decision) — resolved to an IRI against the field's
 *  own `RelationTargetOption[]` only at validate/reconcile time. */
export type RelationFormValues = Record<string, string | string[]>;

/** One relation field's persistable change, as computed by `reconcileRelationValues` — object
 *  identity, not literal value, so a plain set diff (not `AttributeValueSubmission`'s multiset one)
 *  is correct: asserting the same triple twice is a no-op in RDF regardless of how many rows typed it. */
export interface RelationValueSubmission {
	predicateIri: string;
	/** The relation's own `rdfs:label` (`RelationFieldSpecLike.name`) — carried through so the caller
	 *  can add via `SparqlConnector.insertAssertion`'s label-resolution path (STORY-114's decision to
	 *  reuse that exact mechanism) without a second lookup. */
	predicateLabel: string;
	/** Object IRIs to assert that weren't already asserted. */
	added: string[];
	/** Object IRIs already asserted that are no longer selected. */
	removed: string[];
}

function normalizeSingleText(value: string | string[] | undefined): string {
	if (Array.isArray(value)) return '';
	return (value ?? '').trim();
}

function normalizeRowTexts(value: string | string[] | undefined): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => v.trim()).filter((v) => v.length > 0);
}

/** Seeds a fresh `RelationFormValues` for a class's relation-field list — `''` for each single-valued
 *  field, `[]` (no rows yet) for each repeatable one. Mirrors `emptyAttributeFormValues`. */
export function emptyRelationFormValues(relations: RelationFieldSpecLike[]): RelationFormValues {
	const values: RelationFormValues = {};
	for (const rel of relations) values[rel.iri] = rel.repeatable ? [] : '';
	return values;
}

/** Seeds a fresh `RelationFormValues` from each field's currently-asserted target labels (edit mode)
 *  — `assertedLabels` is keyed by relation IRI, one label per currently-asserted object (already
 *  resolved by the caller, e.g. via `objectDisplayLabel` against a `FetchedAssertion[]` filtered to
 *  this predicate). Every field in `relations` gets an entry even when `assertedLabels` has none for it
 *  (never had a value set), matching `mergeAttributeFormValues`'s own fill-in behavior. */
export function mergeRelationFormValues(
	relations: RelationFieldSpecLike[],
	assertedLabels: Record<string, string[]>
): RelationFormValues {
	const values = emptyRelationFormValues(relations);
	for (const rel of relations) {
		const labels = assertedLabels[rel.iri];
		if (!labels || labels.length === 0) continue;
		values[rel.iri] = rel.repeatable ? labels : (labels[0] ?? '');
	}
	return values;
}

/** Exact-label lookup against a relation field's own target options — the same "must match the list
 *  exactly" rule the existing Assertions object picker already enforces (`MemberForm.svelte`'s
 *  `submitAddAssertion`), applied per relation field instead of globally. */
export function resolveRelationTargetIri(options: RelationTargetOption[], label: string): string | undefined {
	return options.find((o) => o.label === label)?.iri;
}

/** Relation field IRIs that fail validation: either required with no resolvable non-blank selection,
 *  or carrying a non-blank typed value that doesn't match any of that field's own target options.
 *  `missing` and `invalid` are disjoint — a required-and-unmatched field is reported only in `invalid`,
 *  since "you typed something, but it doesn't resolve" is the more specific, actionable message. */
export function validateRelationSelections(
	relations: RelationFieldSpecLike[],
	values: RelationFormValues,
	targetOptionsByField: Record<string, RelationTargetOption[]>
): { missing: string[]; invalid: string[] } {
	const missing: string[] = [];
	const invalid: string[] = [];
	for (const rel of relations) {
		const options = targetOptionsByField[rel.iri] ?? [];
		const texts = rel.repeatable ? normalizeRowTexts(values[rel.iri]) : [normalizeSingleText(values[rel.iri])].filter((t) => t.length > 0);
		if (texts.length === 0) {
			if (rel.required) missing.push(rel.iri);
			continue;
		}
		const hasUnmatched = texts.some((text) => resolveRelationTargetIri(options, text) === undefined);
		if (hasUnmatched) invalid.push(rel.iri);
	}
	return { missing, invalid };
}

/**
 * Diffs `originalObjectIris` (the object IRIs already asserted for each relation field when the form
 * opened — empty in create mode) against `current` (live form state, resolved to IRIs against each
 * field's own target options) into exactly the add/remove pairs a caller applies via
 * `SparqlConnector.insertAssertion`/`deleteAssertion`. A relation with no net change is omitted. Text
 * that doesn't resolve to any target option is silently dropped here — `validateRelationSelections`
 * is responsible for blocking submit on that case before this ever runs.
 */
export function reconcileRelationValues(
	relations: RelationFieldSpecLike[],
	originalObjectIris: Record<string, string[]>,
	current: RelationFormValues,
	targetOptionsByField: Record<string, RelationTargetOption[]>
): RelationValueSubmission[] {
	const submissions: RelationValueSubmission[] = [];
	for (const rel of relations) {
		const options = targetOptionsByField[rel.iri] ?? [];
		const texts = rel.repeatable ? normalizeRowTexts(current[rel.iri]) : [normalizeSingleText(current[rel.iri])].filter((t) => t.length > 0);
		const currentIris = new Set(
			texts.map((text) => resolveRelationTargetIri(options, text)).filter((iri): iri is string => iri !== undefined)
		);
		const originalIris = new Set(originalObjectIris[rel.iri] ?? []);
		const added = [...currentIris].filter((iri) => !originalIris.has(iri));
		const removed = [...originalIris].filter((iri) => !currentIris.has(iri));
		if (added.length > 0 || removed.length > 0) {
			submissions.push({ predicateIri: rel.iri, predicateLabel: rel.name, added, removed });
		}
	}
	return submissions;
}
