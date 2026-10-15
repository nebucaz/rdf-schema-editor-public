/**
 * Structural fingerprint of a `QueryModel` for the SPL print/parse guarantee: drops everything the
 * SPL text does not carry (ids, headers, namespaces, colour rules) and rewrites id references into the
 * structure they point at, so two models that mean the same query compare equal. Pure.
 */
import type { QueryModel } from './query-model';

export interface NormalisedModel {
	root: { classIri: string; includeSubclasses: boolean };
	hops: string[];
	filters: { hop: string; propertyIri: string | null; op: string; value: string | string[] | null; relative: string | null; group: number | null }[];
	columns: { hop: string; source: string }[];
	aggregation: {
		groupBy: string[];
		measures: { fn: string; of: string; alias: string }[];
		having: { measure: string; op: string; value: number }[];
	} | null;
	sort: { key: string; direction: string }[];
	limit: number | null;
}

export function normaliseModel(model: QueryModel): NormalisedModel {
	const hopById = new Map(model.hops.map((h) => [h.id, h]));
	const pathOf = (hopId: string | null): string => {
		const parts: string[] = [];
		for (let id = hopId; id !== null; ) {
			const h = hopById.get(id);
			if (!h) break;
			parts.unshift(`${h.direction === 'forward' ? '' : '^'}${h.propertyIri}`);
			id = h.parentHopId;
		}
		return parts.join('>');
	};
	const columnKey = new Map(
		model.columns.map((c) => [
			c.id,
			`${pathOf(c.hopId)}|${typeof c.source === 'string' ? c.source : `p:${c.source.propertyIri}`}`
		])
	);
	const ref = (id: string) => columnKey.get(id) ?? `alias:${id}`;
	const agg = model.aggregation;
	// Columns of an aggregated query that no group-by or measure uses are not part of the SPL text.
	const usedColumns = agg ? new Set([...agg.groupBy, ...agg.measures.map((m) => m.of)]) : null;
	const shown = model.columns
		.filter((c) => usedColumns === null || usedColumns.has(c.id))
		.map((c) => ({ hop: pathOf(c.hopId), source: typeof c.source === 'string' ? c.source : c.source.propertyIri }));
	// Column order is only meaningful in a plain query (`| fields a, b`); an aggregated one derives it.
	const columns = usedColumns === null ? shown : [...shown].sort((a, b) => `${a.hop}|${a.source}`.localeCompare(`${b.hop}|${b.source}`));
	// OR groups are compared by first appearance, not by their ids (the SPL text carries none).
	const groupNumber = new Map<string, number>();
	for (const f of model.filters) if (f.orGroup && !groupNumber.has(f.orGroup)) groupNumber.set(f.orGroup, groupNumber.size + 1);
	return {
		root: { ...model.root },
		hops: model.hops.map((h) => pathOf(h.id)),
		filters: model.filters.map((f) => ({
			hop: pathOf(f.hopId),
			propertyIri: f.propertyIri,
			op: f.op,
			value: f.value === undefined ? null : f.value,
			relative: f.relativeTime ?? null,
			group: f.orGroup ? groupNumber.get(f.orGroup)! : null
		})),
		columns,
		aggregation: agg
			? {
					groupBy: agg.groupBy.map(ref),
					measures: agg.measures.map((m) => ({ fn: m.fn, of: m.of === 'root' ? 'root' : ref(m.of), alias: m.alias })),
					having: (agg.having ?? []).map((h) => ({ ...h }))
				}
			: null,
		sort: model.sort.map((s) => ({ key: ref(s.columnId), direction: s.direction })),
		limit: model.limit ?? null
	};
}
