/**
 * Pure, immutable edit helpers for `QueryModel` (STORY-188). The builder UI mutates its model only
 * through these — each returns a new model and never touches its input — so the editing rules are
 * unit-testable without Svelte. Later builder stories (hops, filters, aggregation) add to this file.
 */
import {
	canExtendPath,
	emptyQueryModel,
	type Column,
	type ColumnSource,
	type Filter,
	type Having,
	type Hop,
	type Measure,
	type QueryModel
} from './query-model';
import { isComparisonOp } from './query-datatypes';
import type { BuilderSchema } from './query-builder-schema';

/** `max(existing numeric suffix) + 1` — never reuses an id of a removed item within one model. */
function nextId(prefix: string, existing: readonly string[]): string {
	let max = 0;
	for (const id of existing) {
		if (!id.startsWith(prefix)) continue;
		const n = Number(id.slice(prefix.length));
		if (Number.isInteger(n) && n > max) max = n;
	}
	return `${prefix}${max + 1}`;
}

export function startQueryFromClass(classIri: string, namespaces: string[]): QueryModel {
	return emptyQueryModel(classIri, namespaces);
}

/** "Open query builder with SAP preselected": root = the hit's class, `eq` filter on its IRI. */
export function startQueryFromSearchHit(
	hit: { classIri: string; iri: string; label: string },
	namespaces: string[]
): QueryModel {
	return addFilter(startQueryFromClass(hit.classIri, namespaces), {
		hopId: null,
		propertyIri: null,
		op: 'eq',
		value: hit.iri
	});
}

export function setIncludeSubclasses(model: QueryModel, include: boolean): QueryModel {
	return { ...model, root: { ...model.root, includeSubclasses: include } };
}

export function setNamespaces(model: QueryModel, namespaces: string[]): QueryModel {
	return { ...model, namespaces: [...namespaces] };
}

const sameSource = (a: ColumnSource, b: ColumnSource): boolean =>
	typeof a === 'string' || typeof b === 'string'
		? a === b
		: a.propertyIri === b.propertyIri;

export function findColumn(
	model: QueryModel,
	hopId: string | null,
	source: ColumnSource
): Column | undefined {
	return model.columns.find((c) => c.hopId === hopId && sameSource(c.source, source));
}

export function hasColumn(model: QueryModel, hopId: string | null, source: ColumnSource): boolean {
	return findColumn(model, hopId, source) !== undefined;
}

/** No-op when the same hop+source column is already present. */
export function addColumn(model: QueryModel, column: Omit<Column, 'id'>): QueryModel {
	if (hasColumn(model, column.hopId, column.source)) return model;
	const id = nextId('c', model.columns.map((c) => c.id));
	return { ...model, columns: [...model.columns, { ...column, id }] };
}

/** Also drops sort keys, group-by entries, measures and colour rules that referenced the column. */
export function removeColumn(model: QueryModel, columnId: string): QueryModel {
	const next: QueryModel = {
		...model,
		columns: model.columns.filter((c) => c.id !== columnId),
		sort: model.sort.filter((s) => s.columnId !== columnId)
	};
	if (model.columnRules) {
		next.columnRules = model.columnRules.filter((r) => r.columnId !== columnId);
	}
	if (model.aggregation) {
		// count / count-distinct fall back to the entity; sum/avg/min/max have no entity form, so they
		// go, taking their having conditions and sort keys with them.
		const dropped = new Set(
			model.aggregation.measures
				.filter((m) => m.of === columnId && m.fn !== 'count' && m.fn !== 'countDistinct')
				.map((m) => m.alias)
		);
		const measures = model.aggregation.measures
			.filter((m) => !dropped.has(m.alias))
			.map((m) => (m.of === columnId ? { ...m, of: 'root' } : m));
		const having = (model.aggregation.having ?? []).filter((h) => !dropped.has(h.measure));
		next.aggregation = {
			groupBy: model.aggregation.groupBy.filter((g) => g !== columnId),
			measures,
			...(having.length > 0 ? { having } : {})
		};
		next.sort = next.sort.filter((s) => !dropped.has(s.columnId));
	}
	return next;
}

export function addFilter(model: QueryModel, filter: Omit<Filter, 'id'>): QueryModel {
	const id = nextId('f', model.filters.map((f) => f.id));
	return { ...model, filters: [...model.filters, { ...filter, id }] };
}

/**
 * Re-entering a filter edits the existing one instead of stacking: one per hop+property, except that
 * comparisons are keyed by operator too, so a range (`gte` + `lt`) can coexist and each bound is
 * edited on its own.
 */
export function upsertFilter(model: QueryModel, draft: Omit<Filter, 'id'>): QueryModel {
	const comparison = isComparisonOp(draft.op);
	const existing = model.filters.find(
		(f) =>
			f.hopId === draft.hopId &&
			f.propertyIri === draft.propertyIri &&
			(comparison ? f.op === draft.op : !isComparisonOp(f.op))
	);
	if (!existing) return addFilter(model, draft);
	return {
		...model,
		filters: model.filters.map((f) =>
			f.id === existing.id ? { ...draft, id: f.id, ...(f.orGroup ? { orGroup: f.orGroup } : {}) } : f
		)
	};
}

/** Patches one filter in place of the same id; every other field of it is kept. */
export function updateFilter(
	model: QueryModel,
	filterId: string,
	patch: Partial<Omit<Filter, 'id'>>
): QueryModel {
	return {
		...model,
		filters: model.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f))
	};
}

export function removeFilter(model: QueryModel, filterId: string): QueryModel {
	return dissolveSmallGroups({ ...model, filters: model.filters.filter((f) => f.id !== filterId) });
}

// ── OR groups (STORY-232) ───────────────────────────────────────────────────

/** An OR group needs two members: a group left with one is dissolved (its member becomes plain). */
function dissolveSmallGroups(model: QueryModel): QueryModel {
	const sizes = new Map<string, number>();
	for (const f of model.filters) if (f.orGroup) sizes.set(f.orGroup, (sizes.get(f.orGroup) ?? 0) + 1);
	if (![...sizes.values()].some((n) => n < 2)) return model;
	return {
		...model,
		filters: model.filters.map((f) => {
			if (!f.orGroup || sizes.get(f.orGroup)! >= 2) return f;
			const { orGroup: _dropped, ...plain } = f;
			return plain;
		})
	};
}

/**
 * Makes the given filters one "any of" group (OR-ed with each other, AND-ed with the rest). Filters
 * already in a group pull their whole group in, so groups merge rather than nest. Members are moved
 * next to each other at the first member's position, which is the canonical order the SPL printer
 * and parser agree on. Fewer than two (existing) ids returns the model unchanged.
 */
export function groupFilters(model: QueryModel, filterIds: readonly string[]): QueryModel {
	const ids = new Set(filterIds);
	if (ids.size < 2 || [...ids].some((id) => !model.filters.some((f) => f.id === id))) return model;
	const touched = new Set(model.filters.filter((f) => ids.has(f.id) && f.orGroup).map((f) => f.orGroup!));
	const isMember = (f: Filter) => ids.has(f.id) || (f.orGroup !== undefined && touched.has(f.orGroup));
	const taken = model.filters.map((f) => Number(/^g(\d+)$/.exec(f.orGroup ?? '')?.[1] ?? 0));
	const group = `g${Math.max(0, ...taken) + 1}`;
	const members = model.filters.filter(isMember).map((f) => ({ ...f, orGroup: group }));
	const firstAt = model.filters.findIndex(isMember);
	const before = model.filters.slice(0, firstAt);
	const after = model.filters.slice(firstAt).filter((f) => !isMember(f));
	return { ...model, filters: [...before, ...members, ...after] };
}

/** Dissolves one group: every member becomes a plain (AND-ed) filter again. */
export function ungroupFilters(model: QueryModel, groupId: string): QueryModel {
	return {
		...model,
		filters: model.filters.map((f) => {
			if (f.orGroup !== groupId) return f;
			const { orGroup: _dropped, ...plain } = f;
			return plain;
		})
	};
}

/** Takes one filter out of its group; a group left with a single member is dissolved. */
export function removeFromGroup(model: QueryModel, filterId: string): QueryModel {
	return dissolveSmallGroups({
		...model,
		filters: model.filters.map((f) => {
			if (f.id !== filterId || !f.orGroup) return f;
			const { orGroup: _dropped, ...plain } = f;
			return plain;
		})
	});
}

/**
 * Expands a relationship from `parentHopId` (`null` = the root). For an `inverse` expansion,
 * `relationship.targetClassIri` is the class that declares the relationship (the hop's entity). The
 * cycle rule lives only in `canExtendPath` (research Q6); a rejected expansion returns the model
 * unchanged.
 */
export function addHop(
	model: QueryModel,
	parentHopId: string | null,
	relationship: { iri: string; targetClassIri: string },
	direction: Hop['direction'] = 'forward'
): QueryModel {
	if (!canExtendPath(model, parentHopId, relationship.iri, direction, relationship.targetClassIri)) return model;
	const id = nextId('h', model.hops.map((h) => h.id));
	return {
		...model,
		hops: [
			...model.hops,
			{
				id,
				parentHopId,
				propertyIri: relationship.iri,
				direction,
				targetClassIri: relationship.targetClassIri
			}
		]
	};
}

/**
 * How the builder labels the edge into a hop: `label →` for a forward hop, `← label` for an inverse
 * one. Falls back to the property IRI when the schema no longer declares the relationship.
 */
export function hopViaLabel(model: QueryModel, schema: BuilderSchema, hop: Hop): string {
	const parentClassIri =
		hop.parentHopId === null
			? model.root.classIri
			: (model.hops.find((h) => h.id === hop.parentHopId)?.targetClassIri ?? '');
	const parent = schema.classes.get(parentClassIri);
	if (hop.direction === 'inverse') {
		const inbound = parent?.inboundRelationships.find(
			(r) => r.iri === hop.propertyIri && r.sourceClassIri === hop.targetClassIri
		);
		return `← ${inbound?.displayLabel ?? hop.propertyIri}`;
	}
	return `${parent?.relationships.find((r) => r.iri === hop.propertyIri)?.label ?? hop.propertyIri} →`;
}

/** Removes a hop, its descendants, and every column/filter/sort/group-by/measure that used them. */
export function removeHop(model: QueryModel, hopId: string): QueryModel {
	const doomed = new Set<string>([hopId]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const h of model.hops) {
			if (!doomed.has(h.id) && h.parentHopId !== null && doomed.has(h.parentHopId)) {
				doomed.add(h.id);
				grew = true;
			}
		}
	}
	let next: QueryModel = dissolveSmallGroups({
		...model,
		hops: model.hops.filter((h) => !doomed.has(h.id)),
		filters: model.filters.filter((f) => f.hopId === null || !doomed.has(f.hopId))
	});
	for (const c of model.columns) {
		if (c.hopId !== null && doomed.has(c.hopId)) next = removeColumn(next, c.id);
	}
	return next;
}

// ── Column order / header ───────────────────────────────────────────────────

/** Moves a column one step (`-1` earlier, `+1` later); returns the same model at the ends. */
export function moveColumn(model: QueryModel, columnId: string, delta: -1 | 1): QueryModel {
	const from = model.columns.findIndex((c) => c.id === columnId);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= model.columns.length) return model;
	const columns = [...model.columns];
	[columns[from], columns[to]] = [columns[to], columns[from]];
	return { ...model, columns };
}

export function setColumnHeader(model: QueryModel, columnId: string, header: string): QueryModel {
	return {
		...model,
		columns: model.columns.map((c) => (c.id === columnId ? { ...c, header } : c))
	};
}

// ── Sort ────────────────────────────────────────────────────────────────────

/** What the sort editor may offer: every column, or — when aggregated — grouped columns + measures. */
export function allowedSortKeys(model: QueryModel): { id: string; label: string }[] {
	const agg = model.aggregation;
	if (!agg) return model.columns.map((c) => ({ id: c.id, label: c.header }));
	const byId = new Map(model.columns.map((c) => [c.id, c]));
	return [
		...agg.groupBy.flatMap((g) => {
			const c = byId.get(g);
			return c ? [{ id: c.id, label: c.header }] : [];
		}),
		...agg.measures.map((m) => ({ id: m.alias, label: m.alias }))
	];
}

/** Appends a sort key, or changes the direction of an existing one in place (precedence kept). */
export function setSort(
	model: QueryModel,
	columnId: string,
	direction: 'asc' | 'desc'
): QueryModel {
	if (!allowedSortKeys(model).some((k) => k.id === columnId)) return model;
	const exists = model.sort.some((s) => s.columnId === columnId);
	return {
		...model,
		sort: exists
			? model.sort.map((s) => (s.columnId === columnId ? { ...s, direction } : s))
			: [...model.sort, { columnId, direction }]
	};
}

/** Header click: none → asc → desc → none. New keys are appended (lowest precedence). */
export function cycleSort(model: QueryModel, columnId: string): QueryModel {
	if (!allowedSortKeys(model).some((k) => k.id === columnId)) return model;
	const current = model.sort.find((s) => s.columnId === columnId);
	if (!current) return setSort(model, columnId, 'asc');
	return current.direction === 'asc' ? setSort(model, columnId, 'desc') : removeSort(model, columnId);
}

export function removeSort(model: QueryModel, columnId: string): QueryModel {
	return { ...model, sort: model.sort.filter((s) => s.columnId !== columnId) };
}

/** Changes sort precedence by one step (`-1` = more significant). */
export function moveSort(model: QueryModel, columnId: string, delta: -1 | 1): QueryModel {
	const from = model.sort.findIndex((s) => s.columnId === columnId);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= model.sort.length) return model;
	const sort = [...model.sort];
	[sort[from], sort[to]] = [sort[to], sort[from]];
	return { ...model, sort };
}

// ── Aggregation ─────────────────────────────────────────────────────────────

function uniqueAlias(model: QueryModel, base: string): string {
	const taken = new Set([
		...model.columns.map((c) => c.id),
		...(model.aggregation?.measures.map((m) => m.alias) ?? [])
	]);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Switches to aggregate mode with one `COUNT` of the root entity and nothing grouped yet. */
export function enableAggregation(model: QueryModel): QueryModel {
	if (model.aggregation) return model;
	return {
		...model,
		aggregation: { groupBy: [], measures: [{ fn: 'count', of: 'root', alias: uniqueAlias(model, 'total') }] }
	};
}

/** Back to plain rows; drops sort keys that only existed as measure aliases. */
export function disableAggregation(model: QueryModel): QueryModel {
	if (!model.aggregation) return model;
	const ids = new Set(model.columns.map((c) => c.id));
	const next: QueryModel = { ...model, sort: model.sort.filter((s) => ids.has(s.columnId)) };
	delete next.aggregation;
	return next;
}

/** No-op outside aggregate mode. Ungrouping a column also drops its sort key (invalid when aggregated). */
export function toggleGroupBy(model: QueryModel, columnId: string): QueryModel {
	const agg = model.aggregation;
	if (!agg) return model;
	if (agg.groupBy.includes(columnId)) {
		return {
			...model,
			aggregation: { ...agg, groupBy: agg.groupBy.filter((g) => g !== columnId) },
			sort: model.sort.filter((s) => s.columnId !== columnId)
		};
	}
	if (!model.columns.some((c) => c.id === columnId)) return model;
	return { ...model, aggregation: { ...agg, groupBy: [...agg.groupBy, columnId] } };
}

/** `of` is a column id or `'root'`; the alias is generated and always a plain identifier. */
export function addMeasure(
	model: QueryModel,
	fn: Measure['fn'],
	of: string
): QueryModel {
	const agg = model.aggregation;
	if (!agg) return model;
	if (of !== 'root' && !model.columns.some((c) => c.id === of)) return model;
	const alias = uniqueAlias(model, fn === 'count' ? 'count' : fn === 'countDistinct' ? 'distinct' : fn);
	return { ...model, aggregation: { ...agg, measures: [...agg.measures, { fn, of, alias }] } };
}

export function removeMeasure(model: QueryModel, alias: string): QueryModel {
	const agg = model.aggregation;
	if (!agg) return model;
	const { having: _having, ...rest } = agg;
	const kept = (agg.having ?? []).filter((h) => h.measure !== alias);
	return {
		...model,
		aggregation: {
			...rest,
			measures: agg.measures.filter((m) => m.alias !== alias),
			...(kept.length > 0 ? { having: kept } : {})
		},
		sort: model.sort.filter((s) => s.columnId !== alias)
	};
}

/** Adds a threshold on a measure (ANDed with the others). Unknown measure or non-finite value: no-op. */
export function addHaving(model: QueryModel, having: Having): QueryModel {
	const agg = model.aggregation;
	if (!agg || !agg.measures.some((m) => m.alias === having.measure)) return model;
	if (!Number.isFinite(having.value)) return model;
	return { ...model, aggregation: { ...agg, having: [...(agg.having ?? []), { ...having }] } };
}

/** Removes the `index`-th threshold; the key disappears with the last one. */
export function removeHaving(model: QueryModel, index: number): QueryModel {
	const agg = model.aggregation;
	if (!agg?.having || index < 0 || index >= agg.having.length) return model;
	const { having: _having, ...rest } = agg;
	const kept = agg.having.filter((_, i) => i !== index);
	return { ...model, aggregation: { ...rest, ...(kept.length > 0 ? { having: kept } : {}) } };
}

// ── Row limit ───────────────────────────────────────────────────────────────

/** `null` clears the cap. Range checking is validation's job; the UI pre-checks with `parseLimitInput`. */
export function setLimit(model: QueryModel, limit: number | null): QueryModel {
	const { limit: _limit, ...rest } = model;
	return limit === null ? rest : { ...rest, limit };
}
