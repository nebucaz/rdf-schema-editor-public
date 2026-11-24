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

function localNameOf(iri: string): string {
	const cut = Math.max(iri.lastIndexOf('#'), iri.lastIndexOf('/'));
	return cut >= 0 && cut < iri.length - 1 ? iri.slice(cut + 1) : iri;
}

/** Makes typeahead option labels unique: a label occurring more than once gets the IRI local name
 *  appended (`"[api] Meter (DelayMeter)"`), plus a counter when local names collide too. Unique labels
 *  stay byte-identical, order and IRIs are kept, the input is not mutated. Labels are the resolution key
 *  (`resolveRelationTargetIri`), so every list feeding a label-resolved typeahead goes through this. */
export function disambiguateOptionLabels<T extends RelationTargetOption>(options: T[]): T[] {
	const counts = new Map<string, number>();
	for (const o of options) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
	const taken = new Set(options.filter((o) => counts.get(o.label) === 1).map((o) => o.label));
	return options.map((o) => {
		if (counts.get(o.label) === 1) return { ...o };
		const base = `${o.label} (${localNameOf(o.iri)})`;
		let label = base;
		for (let n = 2; taken.has(label); n++) label = `${o.label} (${localNameOf(o.iri)} ${n})`;
		taken.add(label);
		return { ...o, label };
	});
}

/** Typeahead options for the individuals of a relation's target class: `"[prefix] label"` (the prefix keeps
 *  same-label individuals of different namespaces apart), then `disambiguateOptionLabels` for any that still
 *  collide inside one namespace. */
export function relationTargetOptionsFromIndividuals(
	individuals: Array<{ iri: string; label: string; namespaceBaseIri: string }>,
	prefixFor: (namespaceBaseIri: string) => string
): RelationTargetOption[] {
	return disambiguateOptionLabels(
		individuals.map((o) => ({ iri: o.iri, label: `[${prefixFor(o.namespaceBaseIri)}] ${o.label}` }))
	);
}

/** The single option whose label equals `label`, or `undefined` when none or **several** match —
 *  labels are the resolution key of every typeahead, so an ambiguous one must not silently pick the
 *  first individual (`disambiguateOptionLabels` keeps real lists unambiguous). */
export function findUniqueByLabel<T extends { label: string }>(options: T[], label: string): T | undefined {
	let found: T | undefined;
	for (const o of options) {
		if (o.label !== label) continue;
		if (found) return undefined;
		found = o;
	}
	return found;
}

/** Exact-label lookup against a relation field's own target options — the same "must match the list
 *  exactly" rule the existing Assertions object picker already enforces (`MemberForm.svelte`'s
 *  `submitAddAssertion`), applied per relation field instead of globally. An ambiguous label
 *  (several options share it) is unresolved, so validation reports the field instead of linking one. */
export function resolveRelationTargetIri(options: RelationTargetOption[], label: string): string | undefined {
	return findUniqueByLabel(options, label)?.iri;
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
