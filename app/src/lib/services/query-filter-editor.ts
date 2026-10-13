/**
 * Pure rules behind the builder's filter editor (STORY-190): which operators a property offers, typed
 * input validation, and building the `Filter` the model stores. No Svelte, no GraphDB — the UI only
 * renders what these return, so invalid input never reaches the model.
 */
import type { Filter, FilterOp } from './query-model';
import type { BuilderProperty } from './query-builder-schema';
import { extractLocalName } from '../utils/iri';
import { isComparableDatatype } from './query-datatypes';

export const OPERATORS_FOR_STRING: readonly FilterOp[] = ['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty'];
export const OPERATORS_FOR_ENUMERATION: readonly FilterOp[] = ['eq', 'in'];
export const OPERATORS_FOR_TYPED: readonly FilterOp[] = ['eq', 'neq', 'isEmpty', 'isNotEmpty'];
/** Numbers and dates additionally offer ordering comparisons (typed from the schema datatype). */
export const OPERATORS_FOR_COMPARABLE: readonly FilterOp[] = [
	'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'
];
/** Relationship targets are filtered by choosing one entity (its IRI). */
export const OPERATORS_FOR_ENTITY: readonly FilterOp[] = ['eq'];

const INTEGER = new Set([
	'integer', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger',
	'negativeInteger', 'nonPositiveInteger', 'unsignedInt', 'unsignedLong'
]);
const FRACTIONAL = new Set(['decimal', 'double', 'float']);
const TEMPORAL_OR_BOOLEAN = new Set(['boolean', 'date', 'dateTime']);

export function operatorsForProperty(p: Pick<BuilderProperty, 'datatype' | 'allowedValues'>): FilterOp[] {
	if (p.allowedValues && p.allowedValues.length > 0) return [...OPERATORS_FOR_ENUMERATION];
	if (isComparableDatatype(p.datatype)) return [...OPERATORS_FOR_COMPARABLE];
	const dt = extractLocalName(p.datatype);
	if (INTEGER.has(dt) || FRACTIONAL.has(dt) || TEMPORAL_OR_BOOLEAN.has(dt)) return [...OPERATORS_FOR_TYPED];
	return [...OPERATORS_FOR_STRING];
}

const isoDate = (v: string): boolean => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	const d = new Date(`${v}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

/** Returns an error message, or `null` when `value` is acceptable for the XSD `datatype`. */
export function validateFilterValue(datatype: string, value: string): string | null {
	const v = value.trim();
	if (v === '') return 'A value is required';
	const dt = extractLocalName(datatype);
	if (INTEGER.has(dt)) return /^[+-]?\d+$/.test(v) ? null : 'Enter a whole number';
	if (FRACTIONAL.has(dt)) return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(v) ? null : 'Enter a number';
	if (dt === 'boolean') return /^(true|false|1|0)$/.test(v) ? null : 'Enter true or false';
	if (dt === 'date') return isoDate(v) ? null : 'Enter a date as YYYY-MM-DD';
	if (dt === 'dateTime') {
		const ok =
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.test(v) &&
			!Number.isNaN(new Date(v).getTime());
		return ok ? null : 'Enter a date-time as YYYY-MM-DDThh:mm:ss';
	}
	return null;
}

/**
 * Browser pickers emit `YYYY-MM-DDThh:mm` for date-times (no seconds); the model's lexical form
 * requires them, so complete it here rather than rejecting what the control itself produced.
 */
export function normaliseTypedValue(datatype: string, value: string): string {
	const v = value.trim();
	return extractLocalName(datatype) === 'dateTime' && /T\d{2}:\d{2}$/.test(v) ? `${v}:00` : v;
}

export type FilterDraft = Omit<Filter, 'id'>;
export type MakeFilterResult = { ok: true; filter: FilterDraft } | { ok: false; error: string };

export type MakeFilterInput =
	| {
			hopId: string | null;
			property: Pick<BuilderProperty, 'iri' | 'datatype' | 'allowedValues'>;
			op: FilterOp;
			value?: string;
			values?: string[];
	  }
	| { hopId: string | null; entity: { iri: string; label?: string } };

export function makeFilter(input: MakeFilterInput): MakeFilterResult {
	if ('entity' in input) {
		return {
			ok: true,
			filter: { hopId: input.hopId, propertyIri: null, op: 'eq', value: input.entity.iri }
		};
	}
	const { hopId, property, op } = input;
	if (!operatorsForProperty(property).includes(op))
		return { ok: false, error: `Operator "${op}" is not available for this property` };
	const base = { hopId, propertyIri: property.iri, op };
	if (op === 'isEmpty' || op === 'isNotEmpty') return { ok: true, filter: base };
	if (op === 'in') {
		const values = (input.values ?? []).filter((v) => v !== '');
		if (values.length === 0) return { ok: false, error: 'Choose at least one value' };
		return { ok: true, filter: { ...base, value: values } };
	}
	const enumerated = property.allowedValues && property.allowedValues.length > 0;
	const value = enumerated ? (input.value ?? '') : normaliseTypedValue(property.datatype, input.value ?? '');
	const err = enumerated
		? value.trim() === '' ? 'A value is required' : null
		: validateFilterValue(property.datatype, value);
	if (err) return { ok: false, error: err };
	return { ok: true, filter: { ...base, value: value.trim() } };
}

/** Symbols match what the SPL printer emits, so a chip and the Show-query text agree. */
const OP_TEXT: Record<FilterOp, string> = {
	eq: '=', neq: '!=', contains: 'contains', isEmpty: 'is empty', isNotEmpty: 'is not empty', in: 'in',
	gt: '>', gte: '>=', lt: '<', lte: '<='
};

/** Chip text, e.g. `Lifecycle = Production`; `subject` is the property/entity display name. */
export function describeFilter(f: Filter, subject: string): string {
	if (f.op === 'isEmpty' || f.op === 'isNotEmpty') return `${subject} ${OP_TEXT[f.op]}`;
	if (f.op === 'in') return `${subject} in (${(Array.isArray(f.value) ? f.value : []).join(', ')})`;
	return `${subject} ${OP_TEXT[f.op]} ${Array.isArray(f.value) ? f.value.join(', ') : (f.value ?? '')}`;
}

export type MakeRangeResult = { ok: true; filters: FilterDraft[] } | { ok: false; error: string };

/**
 * "Between" helper: a `gte` lower bound and an `lt` upper bound (the model has no `between` op).
 * Either bound may be left empty for an open-ended range, but not both.
 */
export function makeRangeFilters(input: {
	hopId: string | null;
	property: Pick<BuilderProperty, 'iri' | 'datatype' | 'allowedValues'>;
	from: string;
	to: string;
}): MakeRangeResult {
	const { hopId, property } = input;
	if (!operatorsForProperty(property).includes('gte'))
		return { ok: false, error: 'A range needs a number or date property' };
	const from = input.from.trim();
	const to = input.to.trim();
	if (from === '' && to === '') return { ok: false, error: 'Enter a lower or upper bound' };
	const filters: FilterDraft[] = [];
	for (const [op, value] of [['gte', from], ['lt', to]] as const) {
		if (value === '') continue;
		const r = makeFilter({ hopId, property, op, value });
		if (!r.ok) return r;
		filters.push(r.filter);
	}
	return { ok: true, filters };
}

export interface FilterPrefill {
	range: boolean;
	op: FilterOp | null;
	value: string;
	values: string[];
	from: string;
	to: string;
}

const scalar = (v: Filter['value']): string => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

/**
 * Edit-mode initial state for the property filter form from the filters already on that property:
 * a `gte` and/or `lt` alone opens as a range, anything else shows the first filter. Only the
 * first filter is represented — Apply replaces the property's whole set with what the form emits.
 */
export function prefillFromFilters(filters: Filter[]): FilterPrefill {
	const empty: FilterPrefill = { range: false, op: null, value: '', values: [], from: '', to: '' };
	if (filters.length === 0) return empty;
	const gte = filters.find((f) => f.op === 'gte');
	const lt = filters.find((f) => f.op === 'lt');
	if ((gte || lt) && filters.every((f) => f === gte || f === lt)) {
		return { ...empty, range: true, from: scalar(gte?.value), to: scalar(lt?.value) };
	}
	const first = filters[0];
	return Array.isArray(first.value)
		? { ...empty, op: first.op, values: [...first.value] }
		: { ...empty, op: first.op, value: first.value ?? '' };
}
