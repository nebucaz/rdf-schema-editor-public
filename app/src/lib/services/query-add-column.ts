/**
 * Pure helpers behind the add-column modal (workbench-columns, STORY-238): which start classes the
 * first step offers and which relationship steps may extend a query that already exists. Validity is
 * decided only by `canExtendPath` (the STORY-225 cycle rule plus the sibling-duplicate rule), so the
 * modal can never build a path the model layer would reject. No UI, store or GraphDB access.
 */
import type { BuilderClass, BuilderSchema } from './query-builder-schema';
import { canExtendPath, type ColumnSource, type Hop, type QueryModel } from './query-model';
import { addColumn, addHop, removeColumn, startQueryFromClass } from './query-model-edit';
import { classOptions, type ClassOption } from '../utils/query-class-picker';
import { extractLocalName } from '../utils/iri';

export interface ReachableStep {
	/** Group the step expands from; `null` = the root. */
	fromHopId: string | null;
	relationshipIri: string;
	direction: Hop['direction'];
	/** Class the new hop's entity has: the range of a forward step, the declaring class of an inverse one. */
	targetClassIri: string;
	/** Relationship label (`displayLabel` for an inbound step, which disambiguates same-named ones). */
	label: string;
	fromLabel: string;
	targetLabel: string;
	/** Why the step cannot be chosen; `null` = selectable. Disabled steps stay visible. */
	disabledReason: string | null;
}

/**
 * Every relationship step reachable from **any** class already in the query, outbound and inbound.
 * The unit is (from-group, relationship, direction, target), so one class reached through two
 * relationships is two steps. `null` model (no start class yet) offers none — use `startClassOptions`.
 */
export function reachableSteps(model: QueryModel | null, schema: BuilderSchema): ReachableStep[] {
	if (!model) return [];
	const groups: { hopId: string | null; classIri: string }[] = [
		{ hopId: null, classIri: model.root.classIri },
		...model.hops.map((h) => ({ hopId: h.id, classIri: h.targetClassIri }))
	];
	const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
	const steps: ReachableStep[] = [];
	for (const { hopId, classIri } of groups) {
		const cls = schema.classes.get(classIri);
		if (!cls) continue;
		const fromLabel = cls.label;
		const outbound: ReachableStep[] = cls.relationships.map((r) => ({
			fromHopId: hopId,
			relationshipIri: r.iri,
			direction: 'forward',
			targetClassIri: r.targetClassIri,
			label: r.label,
			fromLabel,
			targetLabel: r.targetLabel || extractLocalName(r.targetClassIri),
			disabledReason: canExtendPath(model, hopId, r.iri, 'forward', r.targetClassIri)
				? null
				: `Already expanded here or on this path (${r.label})`
		}));
		const inbound: ReachableStep[] = cls.inboundRelationships.map((r) => ({
			fromHopId: hopId,
			relationshipIri: r.iri,
			direction: 'inverse',
			targetClassIri: r.sourceClassIri,
			label: r.displayLabel,
			fromLabel,
			targetLabel: r.sourceLabel,
			disabledReason: canExtendPath(model, hopId, r.iri, 'inverse', r.sourceClassIri)
				? null
				: `Already expanded here, or on this path, or would undo the previous step (${r.label})`
		}));
		steps.push(...outbound.sort(byLabel), ...inbound.sort(byLabel));
	}
	return steps;
}

/** Options for the first step: every class (`prefix:Name`), or only those of one namespace. */
export function startClassOptions(
	schema: BuilderSchema,
	namespaces: { baseIri: string; prefix: string }[],
	namespaceBaseIri: string | null
): ClassOption[] {
	return classOptions(schema, namespaces, namespaceBaseIri);
}

/** One thing the modal lets the analyst tick: an identity column or a property of the chosen class. */
export interface ColumnChoice {
	source: ColumnSource;
	/** Default header of the column the choice creates. */
	header: string;
	/** What the choice reads from (`Label`, `IRI` or the property's label). */
	name: string;
	/** Property datatype IRI; absent for the identity columns. */
	datatype?: string;
	/** The property is restricted to a fixed list of values. */
	enumeration?: boolean;
}

/** Label and IRI identity columns first, then the class' properties, in schema order. */
export function columnChoices(cls: BuilderClass): ColumnChoice[] {
	return [
		{ source: 'label', header: cls.label, name: 'Label' },
		{ source: 'iri', header: `${cls.label} IRI`, name: 'IRI' },
		...cls.properties.map((p) => ({
			source: { propertyIri: p.iri } as ColumnSource,
			header: p.label,
			name: p.label,
			datatype: p.datatype,
			enumeration: (p.allowedValues?.length ?? 0) > 0
		}))
	];
}

/** Adds the picked columns, in the given order, to `hopId` (`null` = root) of `model`. */
function withColumns(
	model: QueryModel,
	hopId: string | null,
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	return picks.reduce((m, c) => addColumn(m, { hopId, source: c.source, header: c.header }), model);
}

/** First step: a new query rooted at `classIri` carrying the picked columns, as one model value. */
export function applyStartClass(
	classIri: string,
	namespaces: string[],
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	return withColumns(startQueryFromClass(classIri, namespaces), null, picks);
}

/**
 * Related-class step: adds the one hop `step` describes and the picked columns under it. A step
 * `canExtendPath` rejects (it is disabled) leaves the model untouched — the same instance comes back.
 */
export function applyStep(
	model: QueryModel,
	step: Pick<ReachableStep, 'fromHopId' | 'relationshipIri' | 'direction' | 'targetClassIri'>,
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	const withHop = addHop(
		model,
		step.fromHopId,
		{ iri: step.relationshipIri, targetClassIri: step.targetClassIri },
		step.direction
	);
	if (withHop === model) return model;
	const hop = withHop.hops[withHop.hops.length - 1];
	return withColumns(withHop, hop.id, picks);
}

/** Adds more of an existing group's properties; columns the group already has are skipped. */
export function applyToGroup(
	model: QueryModel,
	hopId: string | null,
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[]
): QueryModel {
	return withColumns(model, hopId, picks);
}

/**
 * Edits one group's column set in a single model value: adds `picks` (already-present sources are
 * skipped by `addColumn`) and removes `removeColumnIds`, which also drops their sort/rule/measure ties.
 */
export function applyGroupColumns(
	model: QueryModel,
	hopId: string | null,
	picks: readonly Pick<ColumnChoice, 'source' | 'header'>[],
	removeColumnIds: readonly string[]
): QueryModel {
	if (picks.length === 0 && removeColumnIds.length === 0) return model;
	const added = withColumns(model, hopId, picks);
	return removeColumnIds.reduce((m, id) => removeColumn(m, id), added);
}

/** Search-in-list: case-insensitive match on the relationship, from-class or target-class label. */
export function filterSteps(steps: ReachableStep[], query: string): ReachableStep[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return steps;
	return steps.filter((s) =>
		[s.label, s.fromLabel, s.targetLabel].some((t) => t.toLowerCase().includes(needle))
	);
}

/**
 * The shortest relationship path (alternating class and relationship labels) from any class already
 * in the query to `classIri`, for the "why is this class not offered?" hint. `null` when the class
 * is in the query already, one step away (so it is offered), or not connected at all.
 */
export function nearestPath(
	model: QueryModel,
	schema: BuilderSchema,
	classIri: string
): string[] | null {
	const starts = new Set([model.root.classIri, ...model.hops.map((h) => h.targetClassIri)]);
	if (starts.has(classIri) || !schema.classes.has(classIri)) return null;
	const label = (iri: string) => schema.classes.get(iri)?.label ?? extractLocalName(iri);
	const prev = new Map<string, { from: string; via: string }>();
	const seen = new Set(starts);
	let frontier = [...starts];
	let depth = 0;
	while (frontier.length > 0 && !seen.has(classIri)) {
		depth++;
		const next: string[] = [];
		for (const iri of frontier) {
			const cls = schema.classes.get(iri);
			if (!cls) continue;
			const edges = [
				...cls.relationships.map((r) => ({ to: r.targetClassIri, via: r.label })),
				...cls.inboundRelationships.map((r) => ({ to: r.sourceClassIri, via: `← ${r.displayLabel}` }))
			];
			for (const e of edges) {
				if (seen.has(e.to) || !schema.classes.has(e.to)) continue;
				seen.add(e.to);
				prev.set(e.to, { from: iri, via: e.via });
				next.push(e.to);
			}
		}
		frontier = next;
	}
	if (!prev.has(classIri) || depth < 2) return null;
	const path: string[] = [label(classIri)];
	for (let at = classIri; prev.has(at); ) {
		const p = prev.get(at)!;
		path.unshift(label(p.from), p.via);
		at = p.from;
	}
	return path;
}
