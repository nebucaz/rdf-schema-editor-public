/**
 * Pure rules that keep the visual builder equivalent to SPL (spl-input STORY-222): which measure
 * functions a column allows, which measures can carry a threshold, the row-limit input check, and a
 * "hidden state" audit proving a parsed model has no field the builder cannot display or edit.
 */
import type { BuilderSchema } from './query-builder-schema';
import {
	EXPORT_ROW_CAP,
	type Measure,
	type MeasureFn,
	type QueryModel
} from './query-model';
import {
	isComparableDatatype,
	isComparisonOp,
	isNumericDatatype,
	isTemporalDatatype,
	propertyDatatype
} from './query-datatypes';
import { operatorsForProperty } from './query-filter-editor';

const ALL_FNS: MeasureFn[] = ['count', 'countDistinct', 'sum', 'avg', 'min', 'max'];

function columnDatatype(model: QueryModel, schema: BuilderSchema, columnId: string): string | null {
	const column = model.columns.find((c) => c.id === columnId);
	if (!column || typeof column.source === 'string') return null;
	return propertyDatatype(model, schema, column.hopId, column.source.propertyIri);
}

/** Measure functions the picker offers for `of` (a column id or `'root'`). Mirrors model validation. */
export function measureFnsForColumn(model: QueryModel, schema: BuilderSchema, of: string): MeasureFn[] {
	const base: MeasureFn[] = ['count', 'countDistinct'];
	if (of === 'root') return base;
	const dt = columnDatatype(model, schema, of);
	if (dt === null) return base;
	if (isNumericDatatype(dt)) return [...ALL_FNS];
	if (isTemporalDatatype(dt)) return [...base, 'min', 'max'];
	return base;
}

/** Measures a numeric threshold may be set on: everything except `min`/`max` over a date. */
export function havingMeasures(model: QueryModel, schema: BuilderSchema): Measure[] {
	return (model.aggregation?.measures ?? []).filter((m) => {
		if (m.fn !== 'min' && m.fn !== 'max') return true;
		const dt = columnDatatype(model, schema, m.of);
		return dt === null || isNumericDatatype(dt);
	});
}

/** The Aggregate & limit group starts collapsed, but opens when the model already uses either part. */
export function shapeGroupOpenByDefault(model: QueryModel): boolean {
	return model.aggregation !== undefined || model.limit !== undefined;
}

export type LimitInput = { ok: true; value: number | null } | { ok: false; error: string };

/** Empty text clears the cap; otherwise a whole number from 1 to `EXPORT_ROW_CAP`. */
export function parseLimitInput(text: string): LimitInput {
	const t = text.trim();
	if (t === '') return { ok: true, value: null };
	if (!/^\d+$/.test(t)) return { ok: false, error: 'Enter a whole number' };
	const n = Number(t);
	if (n < 1 || n > EXPORT_ROW_CAP)
		return { ok: false, error: `Row limit must be from 1 to ${EXPORT_ROW_CAP}` };
	return { ok: true, value: n };
}

/**
 * Parts of `model` the builder UI has no control for (empty = fully editable). Used to prove that
 * every model SPL can produce round-trips through the builder without hidden fields.
 */
export function hiddenBuilderState(model: QueryModel, schema: BuilderSchema): string[] {
	const hidden: string[] = [];
	const cls = (hopId: string | null) => {
		const hop = hopId === null ? null : model.hops.find((h) => h.id === hopId);
		return schema.classes.get(hop ? hop.targetClassIri : model.root.classIri);
	};
	for (const f of model.filters) {
		if (f.propertyIri === null) continue;
		const p = cls(f.hopId)?.properties.find((x) => x.iri === f.propertyIri);
		if (!p) {
			// Enumerated/relationship filters are edited through their own pickers.
			continue;
		}
		if (!operatorsForProperty(p).includes(f.op))
			hidden.push(`filter ${f.id}: operator ${f.op} is not offered for ${p.label}`);
		if (isComparisonOp(f.op) && !isComparableDatatype(p.datatype))
			hidden.push(`filter ${f.id}: ${f.op} on a non-comparable property`);
	}
	for (const m of model.aggregation?.measures ?? []) {
		if (!measureFnsForColumn(model, schema, m.of).includes(m.fn))
			hidden.push(`measure ${m.alias}: ${m.fn} is not offered for ${m.of}`);
	}
	const havingOk = new Set(havingMeasures(model, schema).map((m) => m.alias));
	for (const h of model.aggregation?.having ?? []) {
		if (!havingOk.has(h.measure)) hidden.push(`having on ${h.measure} cannot be shown`);
	}
	if (model.limit !== undefined && !parseLimitInput(String(model.limit)).ok)
		hidden.push(`limit ${model.limit} is out of range`);
	return hidden;
}
