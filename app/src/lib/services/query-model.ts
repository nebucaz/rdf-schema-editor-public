/**
 * Query Workbench model — a serialisable, versioned description of a visual query.
 * Pure: no GraphDB access, no Svelte, no DOM. Compiled to SPARQL by `query-compiler.ts`
 * and printed as an SPL-style pipeline by `query-spl.ts`.
 *
 * Boolean logic is deliberately limited: filters are AND-ed, with optional OR groups
 * (`Filter.orGroup`) giving `(a OR b) AND c`. Full DNF (`(a AND b) OR c`), nesting and `NOT` are not
 * expressible — a documented limitation, deferred in `spec/spl-input/plan.md`.
 */

import { RULE_OPS, isPaletteColor, type ColumnRule } from './column-rules';
import { fromBase64Url, toBase64Url } from '../utils/base64url';
import type { BuilderSchema } from './query-builder-schema';
import { isRelativeTime } from './query-relative-time';
import {
	isComparableDatatype,
	isComparisonOp,
	isNumericDatatype,
	isTemporalDatatype,
	lexicalFormError,
	propertyDatatype
} from './query-datatypes';

export interface Hop {
	id: string;
	/** `null` = expands directly from the root. */
	parentHopId: string | null;
	propertyIri: string;
	/**
	 * `forward` follows the relationship from the parent class to `targetClassIri`; `inverse` walks it
	 * backwards, so the relationship is declared on `targetClassIri` and points at the parent class.
	 */
	direction: 'forward' | 'inverse';
	targetClassIri: string;
}

export type FilterOp =
	| 'eq'
	| 'neq'
	| 'contains'
	| 'isEmpty'
	| 'isNotEmpty'
	| 'in'
	| 'gt'
	| 'gte'
	| 'lt'
	| 'lte';

export interface Filter {
	id: string;
	/** Hop whose entity the filter applies to; `null` = the root. */
	hopId: string | null;
	/** Datatype property to test; `null` tests the entity itself (IRI). */
	propertyIri: string | null;
	op: FilterOp;
	/**
	 * Unused for `isEmpty`/`isNotEmpty`; an array for `in`. For `gt/gte/lt/lte` a lexical form that is
	 * typed from the property's schema datatype (a range is two filters, `gte` + `lt`).
	 */
	value?: string | string[];
	/**
	 * Filters sharing the same non-empty `orGroup` are OR-ed with each other; groups and ungrouped
	 * filters are AND-ed, i.e. `(a OR b) AND c`. Full DNF (`(a AND b) OR c`) is a documented
	 * limitation, deferred (see `spec/spl-input/plan.md`). A group needs at least two members.
	 */
	orGroup?: string;
	/**
	 * A relative bound (`-24h`, `+1d`, `now`; see `query-relative-time.ts`) *instead of* `value` on a
	 * `gt/gte/lt/lte` filter over a date/dateTime property. It is resolved at run time against a clock
	 * handed to the compiler, so a saved query or report stays live.
	 */
	relativeTime?: string;
}

export type ColumnSource = 'label' | 'iri' | { propertyIri: string };

export interface Column {
	id: string;
	/** `null` = the root entity. */
	hopId: string | null;
	source: ColumnSource;
	header: string;
}

export interface SortKey {
	/** A column id, or a measure alias in an aggregated query. */
	columnId: string;
	direction: 'asc' | 'desc';
}

export type MeasureFn = 'count' | 'countDistinct' | 'sum' | 'avg' | 'min' | 'max';
const MEASURE_FNS: readonly string[] = ['count', 'countDistinct', 'sum', 'avg', 'min', 'max'];

export interface Measure {
	fn: MeasureFn;
	/**
	 * A column id, or `'root'` for the root entity. `sum/avg/min/max` need a property column: numeric
	 * for `sum/avg`, numeric or date/dateTime for `min/max` (no implicit casting).
	 */
	of: string;
	alias: string;
}

export type HavingOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

/** A threshold on a measure of this aggregation (SPARQL `HAVING`). */
export interface Having {
	/** A measure alias of the same aggregation. */
	measure: string;
	op: HavingOp;
	value: number;
}

export interface Aggregation {
	groupBy: string[];
	measures: Measure[];
	/** All conditions must hold (AND). Absent = no group is dropped. */
	having?: Having[];
}

export type { ColumnRule } from './column-rules';

export interface QueryModel {
	version: 1;
	root: { classIri: string; includeSubclasses: boolean };
	hops: Hop[];
	filters: Filter[];
	columns: Column[];
	sort: SortKey[];
	aggregation?: Aggregation;
	/** Instance-graph base IRIs in scope (research Q12). */
	namespaces: string[];
	columnRules?: ColumnRule[];
	/** Caps the *total* rows (SPL `head N`): 1 … `EXPORT_ROW_CAP`. Absent = no cap. */
	limit?: number;
}

/** Hard cap on exported rows (and therefore on `QueryModel.limit`); re-exported by `query-export.ts`. */
export const EXPORT_ROW_CAP = 50_000;

export type ParseResult = { ok: true; model: QueryModel } | { ok: false; error: string };

export function emptyQueryModel(rootClassIri: string, namespaces: string[] = []): QueryModel {
	return {
		version: 1,
		root: { classIri: rootClassIri, includeSubclasses: true },
		hops: [],
		filters: [],
		columns: [],
		sort: [],
		namespaces: [...namespaces]
	};
}

export function serializeQueryModel(model: QueryModel): string {
	return JSON.stringify(model);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isStrOrNull = (v: unknown): v is string | null => v === null || isStr(v);
const HAVING_OPS: readonly string[] = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'];
const FILTER_OPS: readonly string[] = [
	'eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty', 'in', 'gt', 'gte', 'lt', 'lte'
];

function shapeError(m: Record<string, unknown>): string | null {
	if (!isObj(m.root) || !isStr(m.root.classIri) || typeof m.root.includeSubclasses !== 'boolean')
		return 'root must be { classIri: string, includeSubclasses: boolean }';
	if (!isStrArr(m.namespaces)) return 'namespaces must be an array of strings';

	if (!Array.isArray(m.hops)) return 'hops must be an array';
	for (const h of m.hops) {
		if (
			!isObj(h) || !isStr(h.id) || !isStrOrNull(h.parentHopId) || !isStr(h.propertyIri) ||
			(h.direction !== 'forward' && h.direction !== 'inverse') || !isStr(h.targetClassIri)
		)
			return 'hops contains a malformed entry';
	}

	if (!Array.isArray(m.filters)) return 'filters must be an array';
	for (const f of m.filters) {
		if (
			!isObj(f) || !isStr(f.id) || !isStrOrNull(f.hopId) || !isStrOrNull(f.propertyIri) ||
			!isStr(f.op) || !FILTER_OPS.includes(f.op) ||
			!(f.value === undefined || isStr(f.value) || isStrArr(f.value)) ||
			!(f.orGroup === undefined || (isStr(f.orGroup) && f.orGroup !== '')) ||
			!(f.relativeTime === undefined || isStr(f.relativeTime))
		)
			return 'filters contains a malformed entry';
	}

	if (!Array.isArray(m.columns)) return 'columns must be an array';
	for (const c of m.columns) {
		const srcOk = isObj(c) && (c.source === 'label' || c.source === 'iri' ||
			(isObj(c.source) && isStr(c.source.propertyIri)));
		if (!isObj(c) || !isStr(c.id) || !isStrOrNull(c.hopId) || !srcOk || !isStr(c.header))
			return 'columns contains a malformed entry';
	}

	if (!Array.isArray(m.sort)) return 'sort must be an array';
	for (const s of m.sort) {
		if (!isObj(s) || !isStr(s.columnId) || (s.direction !== 'asc' && s.direction !== 'desc'))
			return 'sort contains a malformed entry';
	}

	if (m.limit !== undefined && typeof m.limit !== 'number') return 'limit must be a number';
	if (m.having !== undefined) return 'having belongs inside aggregation';
	if (m.aggregation !== undefined) {
		const a = m.aggregation;
		if (!isObj(a) || !isStrArr(a.groupBy) || !Array.isArray(a.measures))
			return 'aggregation must be { groupBy: string[], measures: [] }';
		for (const me of a.measures) {
			if (
				!isObj(me) || !isStr(me.fn) || !MEASURE_FNS.includes(me.fn) || !isStr(me.of) ||
				!isStr(me.alias)
			)
				return 'aggregation.measures contains a malformed entry';
		}
		if (a.having !== undefined) {
			if (!Array.isArray(a.having)) return 'aggregation.having must be an array';
			for (const h of a.having) {
				if (
					!isObj(h) || !isStr(h.measure) || !isStr(h.op) || !HAVING_OPS.includes(h.op) ||
					typeof h.value !== 'number'
				)
					return 'aggregation.having contains a malformed entry';
			}
		}
	}

	if (m.columnRules !== undefined) {
		if (!Array.isArray(m.columnRules)) return 'columnRules must be an array';
		for (const r of m.columnRules) {
			if (
				!isObj(r) || !isStr(r.columnId) || !isStr(r.color) || !isObj(r.match) ||
				!isStr(r.match.op) || !(RULE_OPS as readonly string[]).includes(r.match.op) ||
				!(r.match.value === undefined || isStr(r.match.value)) ||
				!(r.chip === undefined || typeof r.chip === 'boolean') ||
				!(r.row === undefined || typeof r.row === 'boolean')
			)
				return 'columnRules contains a malformed entry';
		}
	}
	return null;
}

/** Never throws: returns a typed error for invalid JSON, unknown versions or wrong field types. */
export function parseQueryModel(text: string): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, error: 'Query model is not valid JSON' };
	}
	if (!isObj(raw)) return { ok: false, error: 'Query model must be a JSON object' };
	if (raw.version !== 1) return { ok: false, error: `Unsupported query model version: ${String(raw.version)}` };
	const err = shapeError(raw);
	if (err) return { ok: false, error: err };
	return { ok: true, model: raw as unknown as QueryModel };
}

// ── Share links (STORY-201) ─────────────────────────────────────────────────

/** Conservative cap on the `m` URL parameter; longer models must be saved and shared by id. */
export const MAX_SHARE_PARAM_LENGTH = 4000;

export type EncodeResult = { ok: true; param: string } | { ok: false; error: string };

/** `base64url(JSON)` of the model for `/workbench?m=…`; refuses an over-long encoding. */
export function encodeModelForUrl(model: QueryModel): EncodeResult {
	const param = toBase64Url(serializeQueryModel(model));
	if (param.length > MAX_SHARE_PARAM_LENGTH) {
		return { ok: false, error: 'This query is too large to share as a link — save it first, then share the saved query.' };
	}
	return { ok: true, param };
}

/** Never trusts its input: size-capped, then the same strict parse as a stored model. */
export function decodeModelFromUrl(param: string): ParseResult {
	if (param.length === 0 || param.length > MAX_SHARE_PARAM_LENGTH) {
		return { ok: false, error: 'The shared query link is empty or too long.' };
	}
	const json = fromBase64Url(param);
	if (json === null) return { ok: false, error: 'The shared query link is damaged and could not be read.' };
	const parsed = parseQueryModel(json);
	return parsed.ok
		? parsed
		: { ok: false, error: `The shared query link is not a valid query: ${parsed.error}` };
}

export interface ValidationIssue {
	path: string;
	message: string;
}

/** Aliases become SPARQL variable names, so they must be plain identifiers (STORY-176). */
export const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function measureDatatype(model: QueryModel, schema: BuilderSchema, m: Measure): string | null {
	const column = model.columns.find((c) => c.id === m.of);
	if (!column || typeof column.source === 'string') return null;
	return propertyDatatype(model, schema, column.hopId, column.source.propertyIri);
}

/** Why `sum/avg/min/max` over this measure's column is not allowed, or `null` when it is. */
function numericMeasureProblem(model: QueryModel, schema: BuilderSchema | undefined, m: Measure): string | null {
	if (m.of === 'root') return `${m.fn} needs a property column, not the entity`;
	const column = model.columns.find((c) => c.id === m.of);
	if (!column) return null;
	if (typeof column.source === 'string') return `${m.fn} needs a numeric property column, not the entity ${column.source}`;
	if (!schema) return null;
	const dt = propertyDatatype(model, schema, column.hopId, column.source.propertyIri);
	if (dt === null) return `Unknown property ${column.source.propertyIri}`;
	const ok = isNumericDatatype(dt) || ((m.fn === 'min' || m.fn === 'max') && isTemporalDatatype(dt));
	return ok ? null : `${m.fn} needs a ${m.fn === 'min' || m.fn === 'max' ? 'number or date' : 'numeric'} property`;
}

/**
 * Whether the relationship an inverse hop walks backwards is declared on the hop's target class (or a
 * superclass of it) and points at the parent class or a class related to it by subclassing. `null`
 * when the schema does not know one of the two classes (nothing to check; unknown classes are
 * reported separately).
 */
function inverseHopPointsAtParent(schema: BuilderSchema, hop: Hop, parentClassIri: string): boolean | null {
	const target = schema.classes.get(hop.targetClassIri);
	const parent = schema.classes.get(parentClassIri);
	if (!target || !parent) return null;
	const declaring = [...schema.classes.values()].filter(
		(c) => c.iri === target.iri || c.subclasses.includes(target.iri)
	);
	return declaring.some((c) =>
		c.relationships.some((r) => {
			if (r.iri !== hop.propertyIri) return false;
			const range = schema.classes.get(r.targetClassIri);
			return (
				r.targetClassIri === parent.iri ||
				parent.subclasses.includes(r.targetClassIri) ||
				(range?.subclasses.includes(parent.iri) ?? false)
			);
		})
	);
}

/**
 * Structural validation. When `knownClassIris` is supplied (derived from the builder schema),
 * the root and hop target classes must also exist in it; without it only structure is checked.
 * When `schema` is supplied, comparison filters are also checked against the property's datatype.
 */
export function validateQueryModel(
	model: QueryModel,
	knownClassIris?: ReadonlySet<string>,
	schema?: BuilderSchema
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const add = (path: string, message: string) => issues.push({ path, message });

	if (model.limit !== undefined) {
		if (!Number.isInteger(model.limit) || model.limit < 1 || model.limit > EXPORT_ROW_CAP)
			add('limit', `Row limit must be a whole number from 1 to ${EXPORT_ROW_CAP}`);
	}
	if (!model.root.classIri) add('root.classIri', 'Root class is required');
	else if (knownClassIris && !knownClassIris.has(model.root.classIri))
		add('root.classIri', `Unknown class ${model.root.classIri}`);
	if (model.namespaces.length === 0) add('namespaces', 'At least one namespace must be in scope');

	const hopIds = new Set<string>();
	model.hops.forEach((h, i) => {
		if (hopIds.has(h.id)) add(`hops[${i}].id`, `Duplicate hop id ${h.id}`);
		hopIds.add(h.id);
		if (knownClassIris && !knownClassIris.has(h.targetClassIri))
			add(`hops[${i}].targetClassIri`, `Unknown class ${h.targetClassIri}`);
	});
	const byId = new Map(model.hops.map((h) => [h.id, h]));
	if (schema) {
		model.hops.forEach((h, i) => {
			if (h.direction !== 'inverse') return;
			const parentClass = h.parentHopId === null ? model.root.classIri : byId.get(h.parentHopId)?.targetClassIri;
			if (parentClass === undefined || inverseHopPointsAtParent(schema, h, parentClass) !== false) return;
			add(
				`hops[${i}]`,
				`Inverse hop ${h.id}: ${h.targetClassIri} has no relationship ${h.propertyIri} pointing to ${parentClass}`
			);
		});
	}
	model.hops.forEach((h, i) => {
		if (h.parentHopId === null) return;
		if (!byId.has(h.parentHopId)) {
			add(`hops[${i}].parentHopId`, `Parent hop ${h.parentHopId} does not exist`);
			return;
		}
		const seen = new Set<string>([h.id]);
		for (let p: string | null = h.parentHopId; p !== null; p = byId.get(p)?.parentHopId ?? null) {
			if (seen.has(p)) {
				add(`hops[${i}].parentHopId`, 'Hop parents form a cycle');
				return;
			}
			seen.add(p);
		}
	});

	const checkHop = (path: string, hopId: string | null) => {
		if (hopId !== null && !hopIds.has(hopId)) add(path, `Hop ${hopId} does not exist`);
	};
	model.filters.forEach((f, i) => {
		checkHop(`filters[${i}].hopId`, f.hopId);
		if (f.op === 'in') {
			if (!Array.isArray(f.value) || f.value.length === 0)
				add(`filters[${i}].value`, '"in" needs a non-empty list of values');
		} else if (
			f.op !== 'isEmpty' && f.op !== 'isNotEmpty' && f.relativeTime === undefined &&
			typeof f.value !== 'string'
		) {
			add(`filters[${i}].value`, `"${f.op}" needs a value`);
		}
		if (f.relativeTime !== undefined) {
			if (!isComparisonOp(f.op))
				add(`filters[${i}].relativeTime`, `A relative time needs >, >=, < or <=, not "${f.op}"`);
			else if (!isRelativeTime(f.relativeTime))
				add(`filters[${i}].relativeTime`, `"${f.relativeTime}" is not a relative time such as -24h, +1d or now`);
			if (f.value !== undefined) add(`filters[${i}].value`, 'A relative time replaces the value; give one or the other');
			if (isComparisonOp(f.op) && f.propertyIri !== null && schema) {
				const dt = propertyDatatype(model, schema, f.hopId, f.propertyIri);
				if (dt === null) add(`filters[${i}].propertyIri`, `Unknown property ${f.propertyIri}`);
				else if (!isTemporalDatatype(dt)) add(`filters[${i}].op`, 'A relative time needs a date or dateTime property');
			}
		}
		if (isComparisonOp(f.op)) {
			if (f.propertyIri === null) {
				add(`filters[${i}].propertyIri`, `"${f.op}" needs a property, not the entity itself`);
			} else if (schema && typeof f.value === 'string' && f.relativeTime === undefined) {
				const dt = propertyDatatype(model, schema, f.hopId, f.propertyIri);
				if (dt === null) add(`filters[${i}].propertyIri`, `Unknown property ${f.propertyIri}`);
				else if (!isComparableDatatype(dt))
					add(`filters[${i}].op`, `"${f.op}" needs a number or date property`);
				else {
					const err = lexicalFormError(dt, f.value);
					if (err) add(`filters[${i}].value`, err);
				}
			}
		}
	});

	const groupSizes = new Map<string, number>();
	for (const f of model.filters) {
		if (f.orGroup) groupSizes.set(f.orGroup, (groupSizes.get(f.orGroup) ?? 0) + 1);
	}
	model.filters.forEach((f, i) => {
		if (f.orGroup && groupSizes.get(f.orGroup)! < 2)
			add(`filters[${i}].orGroup`, `OR group "${f.orGroup}" needs at least two filters`);
	});

	const columnIds = new Set<string>();
	model.columns.forEach((c, i) => {
		checkHop(`columns[${i}].hopId`, c.hopId);
		if (columnIds.has(c.id)) add(`columns[${i}].id`, `Duplicate column id ${c.id}`);
		columnIds.add(c.id);
	});

	model.columnRules?.forEach((r, i) => {
		if (!columnIds.has(r.columnId))
			add(`columnRules[${i}].columnId`, `Column ${r.columnId} does not exist`);
		if (!isPaletteColor(r.color))
			add(`columnRules[${i}].color`, 'Colour must be one of the palette keys');
		if ((r.match.op === 'eq' || r.match.op === 'contains') && !r.match.value)
			add(`columnRules[${i}].match.value`, `"${r.match.op}" needs a value`);
	});

	const aliases = new Set<string>();
	model.aggregation?.measures.forEach((m, i) => {
		if (!ALIAS_PATTERN.test(m.alias)) add(`aggregation.measures[${i}].alias`, 'Alias must be a plain identifier');
		else if (aliases.has(m.alias) || columnIds.has(m.alias))
			add(`aggregation.measures[${i}].alias`, `Alias ${m.alias} is already in use`);
		aliases.add(m.alias);
		if (m.of !== 'root' && !columnIds.has(m.of))
			add(`aggregation.measures[${i}].of`, `Column ${m.of} does not exist`);
		else if (m.fn !== 'count' && m.fn !== 'countDistinct') {
			const problem = numericMeasureProblem(model, schema, m);
			if (problem) add(`aggregation.measures[${i}].of`, problem);
		}
	});
	model.aggregation?.having?.forEach((h, i) => {
		const target = model.aggregation!.measures.find((m) => m.alias === h.measure);
		if (!target) add(`aggregation.having[${i}].measure`, `Measure ${h.measure} does not exist`);
		else if (schema && (target.fn === 'min' || target.fn === 'max')) {
			const dt = measureDatatype(model, schema, target);
			if (dt !== null && !isNumericDatatype(dt))
				add(`aggregation.having[${i}].measure`, `Measure ${h.measure} is not numeric, so a number cannot be compared to it`);
		}
		if (!Number.isFinite(h.value)) add(`aggregation.having[${i}].value`, 'Threshold must be a finite number');
	});
	model.aggregation?.groupBy.forEach((g, i) => {
		if (!columnIds.has(g)) add(`aggregation.groupBy[${i}]`, `Column ${g} does not exist`);
	});

	const groupBy = new Set(model.aggregation?.groupBy ?? []);
	model.sort.forEach((s, i) => {
		if (!columnIds.has(s.columnId) && !aliases.has(s.columnId))
			add(`sort[${i}].columnId`, `Column ${s.columnId} does not exist`);
		else if (model.aggregation && !groupBy.has(s.columnId) && !aliases.has(s.columnId))
			add(`sort[${i}].columnId`, 'Aggregated queries can only sort by a grouped column or a measure');
	});
	return issues;
}

/**
 * Advisory findings that never block a run (kept apart from `validateQueryModel`, whose issues are
 * errors): a row limit without a sort takes an arbitrary (but stable) first N.
 */
export function queryModelWarnings(model: QueryModel): ValidationIssue[] {
	const warnings: ValidationIssue[] = [];
	if (model.limit !== undefined && model.sort.length === 0)
		warnings.push({ path: 'limit', message: 'A row limit without a sort keeps an arbitrary first N rows' });
	return warnings;
}

/**
 * `validateQueryModel` plus the extra rules for a model that is about to be *run*: a plain query
 * needs at least one column, an aggregated one at least one measure or group-by. Kept separate so a
 * half-built model (e.g. just after choosing a class) is still structurally valid.
 */
export function validateRunnableQueryModel(
	model: QueryModel,
	knownClassIris?: ReadonlySet<string>,
	schema?: BuilderSchema
): ValidationIssue[] {
	const issues = validateQueryModel(model, knownClassIris, schema);
	if (model.aggregation) {
		if (model.aggregation.groupBy.length === 0 && model.aggregation.measures.length === 0)
			issues.push({ path: 'aggregation', message: 'Add at least one measure or group-by column' });
	} else if (model.columns.length === 0) {
		issues.push({ path: 'columns', message: 'Select at least one column to show' });
	}
	return issues;
}

/**
 * Cycle rule (research Q6, decided in STORY-225 — kept in this one function so it can change):
 * the same property+direction may not appear twice on one root-to-leaf path, and a hop may not
 * immediately undo its parent (same property, opposite direction — trivial ping-pong). Revisiting
 * a class through a different property is fine; the same property on a *different* branch is fine.
 *
 * A sibling rule sits on top of that: the same property + direction (+ target class, when given — a
 * property may point at several classes, an inbound one may come from several) may not be expanded
 * twice from one parent. Two such hops are the identical join, so the second only duplicates
 * columns and splits filters between twins.
 */
export function canExtendPath(
	model: QueryModel,
	parentHopId: string | null,
	propertyIri: string,
	direction: Hop['direction'],
	targetClassIri?: string
): boolean {
	const duplicate = model.hops.some(
		(h) =>
			h.parentHopId === parentHopId &&
			h.propertyIri === propertyIri &&
			h.direction === direction &&
			(targetClassIri === undefined || h.targetClassIri === targetClassIri)
	);
	if (duplicate) return false;
	const byId = new Map(model.hops.map((h) => [h.id, h]));
	const seen = new Set<string>();
	for (let id = parentHopId; id !== null; ) {
		const hop = byId.get(id);
		if (!hop || seen.has(id)) return false;
		if (hop.propertyIri === propertyIri && (hop.direction === direction || id === parentHopId)) return false;
		seen.add(id);
		id = hop.parentHopId;
	}
	return true;
}

/**
 * Identity of everything that changes the *query result*: the model without `columnRules`, which only
 * style how cells are drawn. The workbench re-runs a displayed result when this changes.
 */
export function resultKey(model: QueryModel): string {
	const { columnRules: _display, ...rest } = model;
	void _display;
	return JSON.stringify(rest);
}
