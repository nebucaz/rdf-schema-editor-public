/**
 * SPL-style pipeline printer (research Q23). Nothing here evaluates text; `query-spl-parser.ts` is its
 * inverse. An inverse hop prints as `^relationship`. Output is deterministic — it depends only on array order in the model, never on
 * object key order — and prints labels from the builder schema rather than IRIs.
 */
import type { BuilderSchema } from './query-builder-schema';
import type { Filter, QueryModel } from './query-model';
import { extractLocalName } from '../utils/iri';
import { isNumericDatatype, lexicalFormError, propertyDatatype } from './query-datatypes';

const quote = (v: string): string =>
	`"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;

/** What the SPL tokenizer reads back as one number token; anything else (`5.`, `INF`, `NaN`) stays quoted. */
const BARE_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

const HAVING_SYMBOL = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' } as const;

export function printSplPipeline(model: QueryModel, schema: BuilderSchema): string {
	// IRI -> label for properties, relationships and enumerated values, across every class.
	const labels = new Map<string, string>();
	for (const c of schema.classes.values()) {
		labels.set(c.iri, c.label);
		for (const p of c.properties) {
			labels.set(p.iri, p.label);
			for (const v of p.allowedValues ?? []) if (v.isIri) labels.set(v.value, v.label);
		}
		for (const r of c.relationships) labels.set(r.iri, r.label);
		for (const m of c.members) labels.set(m.value, m.label);
	}
	const label = (iri: string) => labels.get(iri) ?? extractLocalName(iri);
	const display = (value: string) => quote(labels.get(value) ?? value);

	// Dotted path (relationship labels) from the root to each hop.
	const hopById = new Map(model.hops.map((h) => [h.id, h]));
	const pathOf = (hopId: string | null): string => {
		const parts: string[] = [];
		const seen = new Set<string>();
		for (let id = hopId; id !== null; ) {
			const h = hopById.get(id);
			if (!h || seen.has(id)) break;
			seen.add(id);
			parts.unshift(`${h.direction === 'inverse' ? '^' : ''}${label(h.propertyIri)}`);
			id = h.parentHopId;
		}
		return parts.join('.');
	};
	const field = (hopId: string | null, leaf: string): string => {
		const p = pathOf(hopId);
		return p ? `${p}.${leaf}` : leaf;
	};

	const filterField = (f: Filter): string =>
		f.propertyIri === null ? field(f.hopId, 'iri') : field(f.hopId, label(f.propertyIri));
	const columnField = (c: QueryModel['columns'][number]): string =>
		c.source === 'label'
			? field(c.hopId, 'label')
			: c.source === 'iri'
				? field(c.hopId, 'iri')
				: field(c.hopId, label(c.source.propertyIri));

	const rootLabel = label(model.root.classIri);
	const stages: string[] = [model.root.includeSubclasses ? rootLabel : `${rootLabel} (exact)`];

	for (const h of model.hops) stages.push(`| ${pathOf(h.id)}`);

	const filterExpr = (f: Filter): string => {
		const name = filterField(f);
		const values = Array.isArray(f.value) ? f.value : [f.value ?? ''];
		let expr: string;
		switch (f.op) {
			case 'eq':
				expr = `${name}=${display(values[0])}`;
				break;
			case 'neq':
				expr = `${name}!=${display(values[0])}`;
				break;
			case 'contains':
				expr = `like(${name}, ${quote(`%${values[0]}%`)})`;
				break;
			case 'in':
				expr = `${name} IN (${values.map(display).join(', ')})`;
				break;
			case 'gt':
			case 'gte':
			case 'lt':
			case 'lte': {
				const operator = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
				if (f.relativeTime !== undefined) {
					// Kept as written (a quoted expression is unambiguous: it is never a valid date).
					expr = `${name}${operator}${quote(f.relativeTime)}`;
					break;
				}
				const dt = f.propertyIri === null ? null : propertyDatatype(model, schema, f.hopId, f.propertyIri);
				// Numbers print bare (lexical form is validated and must read back as a number token);
				// dates/times and unknowns stay quoted.
				const bare =
					dt !== null &&
					isNumericDatatype(dt) &&
					lexicalFormError(dt, values[0]) === null &&
					BARE_NUMBER.test(values[0]);
				expr = `${name}${operator}${bare ? values[0] : quote(values[0])}`;
				break;
			}
			case 'isEmpty':
				expr = `isnull(${name})`;
				break;
			case 'isNotEmpty':
				expr = `isnotnull(${name})`;
				break;
		}
		return expr;
	};
	// A group prints once, at its first member, as `(a OR b)`; members are contiguous in canonical models.
	const printed = new Set<string>();
	for (const f of model.filters) {
		if (!f.orGroup) {
			stages.push(`| where ${filterExpr(f)}`);
		} else if (!printed.has(f.orGroup)) {
			printed.add(f.orGroup);
			const members = model.filters.filter((m) => m.orGroup === f.orGroup).map(filterExpr);
			stages.push(`| where (${members.join(' OR ')})`);
		}
	}

	const fieldByColumn = new Map(model.columns.map((c) => [c.id, columnField(c)]));
	const agg = model.aggregation;
	if (agg) {
		const measures = agg.measures.map((m) => {
			const target = m.of === 'root' ? rootLabel : fieldByColumn.get(m.of) ?? m.of;
			const fn =
				m.fn === 'countDistinct'
					? `dc(${target})`
					: m.fn !== 'count'
						? `${m.fn}(${target})`
						: m.of === 'root' ? 'count' : `count(${target})`;
			return `${fn} as ${m.alias}`;
		});
		const by = agg.groupBy.map((g) => fieldByColumn.get(g) ?? g);
		stages.push(`| stats ${measures.join(', ')}${by.length ? ` by ${by.join(', ')}` : ''}`);
		for (const h of agg.having ?? []) stages.push(`| where ${h.measure}${HAVING_SYMBOL[h.op]}${h.value}`);
	} else if (model.columns.length > 0) {
		stages.push(`| fields ${model.columns.map(columnField).join(', ')}`);
	}

	if (model.sort.length > 0) {
		const keys = model.sort.map((s) => {
			const name = fieldByColumn.get(s.columnId) ?? s.columnId;
			return `${s.direction === 'desc' ? '-' : ''}${name}`;
		});
		stages.push(`| sort ${keys.join(', ')}`);
	}
	if (model.limit !== undefined) stages.push(`| head ${model.limit}`);
	return stages.join('\n');
}
