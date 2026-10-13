/**
 * Column-group view model (workbench-columns, STORY-237). Re-presents an unchanged `QueryModel` as the
 * column-first builder shows it: one group per root/hop in tree order, each holding its columns, the
 * filters that target those columns, and the group-level entity filter. Pure — no store, DOM or
 * GraphDB access — so any valid model, saved query or parsed SPL renders.
 *
 * Groups derive from `hops`, never from `columns`, so a hop with no columns, and filters on
 * properties that are not columns, still appear (`hiddenFilters`). Nothing is dropped and nothing
 * throws on schema drift: unknown IRIs fall back to their local names.
 */
import type { BuilderProperty, BuilderSchema } from './query-builder-schema';
import { describeFilter } from './query-filter-editor';
import { allowedSortKeys, hopViaLabel } from './query-model-edit';
import type { Column, Filter, Hop, QueryModel, SortKey } from './query-model';
import { extractLocalName } from '../utils/iri';

export interface GroupColumn {
	column: Column;
	/** Property label, `Label` or `IRI` — what the column reads from, as opposed to its header. */
	propertyLabel: string;
	/** 1-based position in the sort precedence, `null` when the column is not sorted. */
	sortRank: number | null;
	sortDirection: SortKey['direction'] | null;
	/** `false` for a column an aggregated query cannot sort by (it is not grouped by). */
	sortable: boolean;
	/** Filters on this column's `(hop, property)`. */
	filters: Filter[];
}

export interface ColumnGroup {
	/** `null` = the root group. */
	hopId: string | null;
	classIri: string;
	label: string;
	/** `label →` / `← label`; `null` for the root. */
	viaLabel: string | null;
	direction: Hop['direction'] | null;
	parentHopId: string | null;
	depth: number;
	columns: GroupColumn[];
	/** Property filters of this group whose property is not one of its columns. */
	hiddenFilters: Filter[];
	/** First `propertyIri: null` filter of the group (the entity itself), if any. */
	entityFilter: Filter | null;
	/** Every entity filter of the group, `entityFilter` first; none is dropped. */
	entityFilters: Filter[];
	isRoot: boolean;
	/** The root only while it has no hops (removing a group cascades; the root is blocked). */
	removable: boolean;
}

export function buildColumnGroups(model: QueryModel, schema: BuilderSchema): ColumnGroup[] {
	const classLabel = (iri: string) => schema.classes.get(iri)?.label ?? extractLocalName(iri);
	const sortableIds = new Set(allowedSortKeys(model).map((k) => k.id));
	const sortIndex = new Map(model.sort.map((s, i) => [s.columnId, { rank: i + 1, direction: s.direction }]));

	// Tree order: depth-first from the root, siblings in `hops` order. Hops whose parent is missing
	// (a malformed model) are appended at depth 1 rather than dropped.
	const children = new Map<string | null, Hop[]>();
	const known = new Set(model.hops.map((h) => h.id));
	for (const h of model.hops) {
		const parent = h.parentHopId !== null && known.has(h.parentHopId) ? h.parentHopId : null;
		if (!children.has(parent)) children.set(parent, []);
		children.get(parent)!.push(h);
	}
	const ordered: { hop: Hop | null; depth: number }[] = [{ hop: null, depth: 0 }];
	const seen = new Set<string>();
	const walk = (parent: string | null, depth: number) => {
		for (const hop of children.get(parent) ?? []) {
			if (seen.has(hop.id)) continue;
			seen.add(hop.id);
			ordered.push({ hop, depth });
			walk(hop.id, depth + 1);
		}
	};
	walk(null, 1);
	// A parent cycle is unreachable from the root; keep those hops visible too.
	for (const hop of model.hops) {
		if (!seen.has(hop.id)) {
			seen.add(hop.id);
			ordered.push({ hop, depth: 1 });
		}
	}

	const hasHops = model.hops.length > 0;
	const hopIds = new Set<string | null>([null, ...known]);

	return ordered.map(({ hop, depth }): ColumnGroup => {
		const hopId = hop?.id ?? null;
		const classIri = hop ? hop.targetClassIri : model.root.classIri;
		const props = schema.classes.get(classIri)?.properties ?? [];
		const propLabel = (iri: string) => props.find((p) => p.iri === iri)?.label ?? extractLocalName(iri);

		const columns = model.columns
			.filter((c) => c.hopId === hopId)
			.map((column): GroupColumn => {
				const src = column.source;
				const propertyIri = typeof src === 'object' ? src.propertyIri : null;
				const sort = sortIndex.get(column.id);
				return {
					column,
					propertyLabel: propertyIri ? propLabel(propertyIri) : src === 'iri' ? 'IRI' : 'Label',
					sortRank: sort?.rank ?? null,
					sortDirection: sort?.direction ?? null,
					sortable: sortableIds.has(column.id),
					filters: propertyIri
						? model.filters.filter((f) => f.hopId === hopId && f.propertyIri === propertyIri)
						: []
				};
			});
		const columnProps = new Set(
			columns.flatMap((c) => (typeof c.column.source === 'object' ? [c.column.source.propertyIri] : []))
		);
		// A filter that points at a hop the model does not have is kept on the root, not lost.
		const mine = (f: Filter) => (hopIds.has(f.hopId) ? f.hopId === hopId : hopId === null);
		const entityFilters = model.filters.filter((f) => mine(f) && f.propertyIri === null);
		return {
			hopId,
			classIri,
			label: classLabel(classIri),
			viaLabel: hop ? hopViaLabel(model, schema, hop) : null,
			direction: hop?.direction ?? null,
			parentHopId: hop?.parentHopId ?? null,
			depth,
			columns,
			hiddenFilters: model.filters.filter(
				(f) => mine(f) && f.propertyIri !== null && !columnProps.has(f.propertyIri)
			),
			entityFilter: entityFilters[0] ?? null,
			entityFilters,
			isRoot: hop === null,
			removable: hop !== null || !hasHops
		};
	});
}

export interface FilterableProperty {
	hopId: string | null;
	classIri: string;
	groupLabel: string;
	property: BuilderProperty;
	/** Whether the property is currently a column of its group; `false` = a filter shows as hidden. */
	isColumn: boolean;
	columnId: string | null;
}

/**
 * Every property of every class the query uses, per group in tree order, with whether it is a column.
 * Properties are exactly what the schema lists for the class (own, not inherited — see
 * `query-builder-schema.ts`); an unknown class contributes nothing.
 */
export function filterableProperties(model: QueryModel, schema: BuilderSchema): FilterableProperty[] {
	return buildColumnGroups(model, schema).flatMap((g) => {
		const props = schema.classes.get(g.classIri)?.properties ?? [];
		return props.map((property): FilterableProperty => {
			const gc = g.columns.find(
				(c) => typeof c.column.source === 'object' && c.column.source.propertyIri === property.iri
			);
			return {
				hopId: g.hopId, classIri: g.classIri, groupLabel: g.label, property,
				isColumn: gc !== undefined, columnId: gc?.column.id ?? null
			};
		});
	});
}

/** Filters on one `(hop, property)`; `propertyIri: null` selects the group's entity filters. */
export function filtersForProperty(model: QueryModel, hopId: string | null, propertyIri: string | null): Filter[] {
	return model.filters.filter((f) => f.hopId === hopId && f.propertyIri === propertyIri);
}

/** The filters that mark `column`: same hop, same property. Entity/IRI/label columns have none. */
export function filtersForColumn(model: QueryModel, column: Column): Filter[] {
	const src = column.source;
	if (typeof src !== 'object') return [];
	return filtersForProperty(model, column.hopId, src.propertyIri);
}

/** What the filter modal edits: one property, a group's entity, or "pick any filterable property". */
export type FilterTarget =
	| { kind: 'property'; hopId: string | null; propertyIri: string }
	| { kind: 'entity'; hopId: string | null }
	| { kind: 'pick' };

export interface FilterMarker {
	hopId: string | null;
	/** `null` = a group-level entity filter. */
	propertyIri: string | null;
	/** The column this marks; `null` for entity filters and for filters on non-column properties. */
	columnId: string | null;
	/** A property filter whose property is not a column. */
	hidden: boolean;
	filters: Filter[];
	text: string;
}

/**
 * One marker per `(hop, property)` carrying filters; a `gte` + `lt` pair reads as one range. Entity
 * filters (`propertyIri: null`) stay group-level, one marker each.
 */
export function filterMarkers(model: QueryModel, schema: BuilderSchema): FilterMarker[] {
	const groups = buildColumnGroups(model, schema);
	const hopIds = new Set(groups.map((g) => g.hopId));
	const markers: FilterMarker[] = [];
	const byKey = new Map<string, FilterMarker>();
	for (const f of model.filters) {
		const hopId = hopIds.has(f.hopId) ? f.hopId : null;
		const group = groups.find((g) => g.hopId === hopId)!;
		if (f.propertyIri === null) {
			const text =
				typeof f.value === 'string' && f.op === 'eq'
					? `${group.label} = ${extractLocalName(f.value)}`
					: describeFilter(f, group.label);
			markers.push({ hopId, propertyIri: null, columnId: null, hidden: false, filters: [f], text });
			continue;
		}
		const key = `${hopId ?? ''}\u0000${f.propertyIri}`;
		let m = byKey.get(key);
		if (!m) {
			const gc = group.columns.find(
				(c) => typeof c.column.source === 'object' && c.column.source.propertyIri === f.propertyIri
			);
			m = { hopId, propertyIri: f.propertyIri, columnId: gc?.column.id ?? null, hidden: !gc, filters: [], text: '' };
			byKey.set(key, m);
			markers.push(m);
		}
		m.filters.push(f);
	}
	for (const m of markers) {
		if (m.propertyIri === null) continue;
		const group = groups.find((g) => g.hopId === m.hopId)!;
		const props = schema.classes.get(group.classIri)?.properties ?? [];
		const subject = props.find((p) => p.iri === m.propertyIri)?.label ?? extractLocalName(m.propertyIri);
		m.text = describeMarker(m.filters, subject);
	}
	return markers;
}

function describeMarker(filters: Filter[], subject: string): string {
	const gte = filters.find((f) => f.op === 'gte');
	const lt = filters.find((f) => f.op === 'lt');
	if (gte && lt) {
		const rest = filters.filter((f) => f !== gte && f !== lt).map((f) => describeFilter(f, subject));
		const bound = (f: Filter) => describeFilter(f, '').trim();
		return [`${subject} ${bound(gte)} and ${bound(lt)}`, ...rest].join('; ');
	}
	return filters.map((f) => describeFilter(f, subject)).join('; ');
}

export interface ColumnMarkerState {
	/** `null` when the column is not a sort key. */
	sort: { direction: SortKey['direction']; rank: number } | null;
	/** More than one sort key — the rank is only worth showing then. */
	multiSort: boolean;
	/** `false` for a column an aggregated query cannot sort by. */
	sortable: boolean;
	/** Accessible name of the sort marker, state included. */
	sortLabel: string;
	/** A property column — the only kind a filter can be defined from. */
	filterable: boolean;
	filterActive: boolean;
	/** The column's filters as one text (ranges merged); `null` when not filtered. */
	filterText: string | null;
	filterLabel: string;
}

/**
 * Sort/filter marker state for every column (and aggregate measure) of the query, keyed by column
 * id, so the builder strip and the results table render the same markers from one source.
 */
export function columnMarkers(model: QueryModel, schema: BuilderSchema): Map<string, ColumnMarkerState> {
	const sortable = new Set(allowedSortKeys(model).map((k) => k.id));
	const sortAt = new Map(model.sort.map((s, i) => [s.columnId, { direction: s.direction, rank: i + 1 }]));
	const multiSort = model.sort.length > 1;
	const filterText = new Map<string, string>();
	for (const m of filterMarkers(model, schema)) if (m.columnId) filterText.set(m.columnId, m.text);

	const propertyColumns = new Set(
		model.columns.filter((c) => typeof c.source === 'object').map((c) => c.id)
	);
	const ids = new Set([...model.columns.map((c) => c.id), ...sortable, ...sortAt.keys()]);
	const out = new Map<string, ColumnMarkerState>();
	for (const id of ids) {
		const sort = sortAt.get(id) ?? null;
		const text = filterText.get(id) ?? null;
		const dir = sort ? (sort.direction === 'asc' ? 'ascending' : 'descending') : null;
		out.set(id, {
			sort,
			multiSort,
			sortable: sortable.has(id),
			sortLabel: sort ? `Sorted ${dir}${multiSort ? `, ${sort.rank} of ${model.sort.length}` : ''}` : 'Not sorted',
			filterable: propertyColumns.has(id),
			filterActive: text !== null,
			filterText: text,
			filterLabel: text !== null ? `Filtered: ${text}` : 'Not filtered'
		});
	}
	return out;
}
