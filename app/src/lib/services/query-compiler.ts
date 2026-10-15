/**
 * Query Workbench compiler: `QueryModel` → SPARQL SELECT. Pure — no GraphDB access.
 *
 * Conventions (see CLAUDE.md "GraphDB query conventions"):
 *  - Instance triples are matched inside `GRAPH ?gN { ... }` with `VALUES ?gN { <ns> ... }` — never
 *    mixed with `FROM`, which silently returns zero rows.
 *  - Inference is off, so subclass-inclusive roots expand to an explicit `VALUES ?type` list.
 *  - Every IRI is checked with `assertSafeSparqlIri`, every literal goes through `escapeSparqlString`.
 *  - Variable names are generated from positions (`?c0`, `?h1`, `?f2`, `?g3`), never from user text.
 */
import type { BuilderSchema } from './query-builder-schema';
import { isComparisonOp, propertyDatatype } from './query-datatypes';
import { resolveRelativeTime } from './query-relative-time';
import {
	validateQueryModel,
	type Filter,
	type QueryModel,
	type ValidationIssue
} from './query-model';
import { assertSafeSparqlIri, escapeSparqlString } from '../utils/sparql-safe';

/** Hard upper bound on a page (research Q10). */
export const MAX_PAGE_SIZE = 1000;

export class QueryCompileError extends Error {
	readonly issues: ValidationIssue[];
	constructor(message: string, issues: ValidationIssue[] = []) {
		super(message);
		this.name = 'QueryCompileError';
		this.issues = issues;
	}
}

export interface CompiledColumn {
	/** The `QueryModel` column id. */
	id: string;
	/** SPARQL result variable name without `?`. */
	variable: string;
	header: string;
}

export interface CompiledQuery {
	sparql: string;
	columns: CompiledColumn[];
	/** `'aggregate'` rows carry no single fact, so they are never annotatable. */
	rowKind: 'facts' | 'aggregate';
	/**
	 * Result variable (without `?`) holding the entity IRI, keyed by hop id or `'root'`. Only hops that
	 * have a selected column are present, and aggregate queries have none — the table uses it for
	 * drill-down and for the fact behind a cell (STORY-192).
	 */
	entityVariables: Record<string, string>;
}

/**
 * The clock is an input, never read here: `now` resolves `Filter.relativeTime` expressions. A model
 * with a relative filter and no `now` is a compile error rather than a silently wrong window.
 */
export interface CompileOptions {
	now?: Date;
}

export interface PageRequest {
	limit: number;
	offset: number;
}

const PREFIXES = 'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\nPREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>';

function iriRef(value: string, what: string): string {
	try {
		assertSafeSparqlIri(value, what);
	} catch (e) {
		throw new QueryCompileError((e as Error).message);
	}
	return `<${value}>`;
}

const HAVING_OPERATORS = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' } as const;

const lit = (v: string) => `"${escapeSparqlString(v)}"`;

interface BuiltQuery {
	/** `SELECT ... WHERE { ... } [GROUP BY ...]` without ORDER BY / LIMIT. */
	body: string;
	order: string[];
	columns: CompiledColumn[];
	rowKind: 'facts' | 'aggregate';
	entityVariables: Record<string, string>;
}

function validateOrThrow(model: QueryModel, schema: BuilderSchema): void {
	const issues = validateQueryModel(model, new Set(schema.classes.keys()), schema);
	if (issues.length > 0) {
		throw new QueryCompileError(`Invalid query model: ${issues[0].message}`, issues);
	}
}

function build(model: QueryModel, schema: BuilderSchema, opts: CompileOptions = {}): BuiltQuery {
	validateOrThrow(model, schema);
	const agg = model.aggregation;

	const namespaces = model.namespaces.map((ns) => iriRef(ns, 'namespace IRI')).join(' ');
	let graphCounter = 0;
	/** A fresh graph variable plus the `VALUES` that binds it to the namespaces in scope. */
	const scoped = (body: (g: string) => string): string => {
		const g = `?g${graphCounter++}`;
		return `VALUES ${g} { ${namespaces} }\n\t\tGRAPH ${g} { ${body(g)} }`;
	};

	// Entity variables: root plus one per hop (by index).
	const hopVar = new Map<string, string>(model.hops.map((h, i) => [h.id, `?h${i}`]));
	const entityVar = (hopId: string | null): string => (hopId === null ? '?root' : hopVar.get(hopId)!);

	const rootClass = schema.classes.get(model.root.classIri);
	const typeIris = [model.root.classIri];
	if (model.root.includeSubclasses && rootClass) typeIris.push(...rootClass.subclasses);
	const typeValues = typeIris.map((t) => iriRef(t, 'class IRI')).join(' ');

	const required: string[] = [
		scoped(() => '?root a ?type .'),
		`VALUES ?type { ${typeValues} }`
	];
	for (const [i, h] of model.hops.entries()) {
		const parent = entityVar(h.parentHopId);
		// An inverse hop walks the relationship backwards: the hop's entity is the subject.
		required.push(
			scoped(() => {
				const p = iriRef(h.propertyIri, 'property IRI');
				return h.direction === 'inverse' ? `?h${i} ${p} ${parent} .` : `${parent} ${p} ?h${i} .`;
			})
		);
	}

	const filterClauses = compileFilters(model, schema, entityVar, scoped, opts);

	// In an aggregated query only grouped or measured columns take part.
	const used = new Set<string>(
		agg ? [...agg.groupBy, ...agg.measures.map((m) => m.of)] : model.columns.map((c) => c.id)
	);

	const select: string[] = agg ? [] : ['?root'];
	const optional: string[] = [];
	const columns: CompiledColumn[] = [];
	const columnVar = new Map<string, string>();
	for (const [i, c] of model.columns.entries()) {
		if (!used.has(c.id)) continue;
		const ent = entityVar(c.hopId);
		let v = `?c${i}`;
		let selected = v;
		if (c.source === 'iri') {
			// Aggregates group by the entity variable itself; plain selects alias it.
			if (agg) v = selected = ent;
			else selected = `(${ent} AS ${v})`;
		} else if (c.source === 'label') {
			optional.push(`OPTIONAL { ${scoped(() => `${ent} rdfs:label ${v} .`)} }`);
		} else {
			const p = iriRef(c.source.propertyIri, 'property IRI');
			optional.push(`OPTIONAL { ${scoped(() => `${ent} ${p} ${v} .`)} }`);
		}
		columnVar.set(c.id, v);
		if (!agg) {
			select.push(selected);
			columns.push({ id: c.id, variable: v.slice(1), header: c.header });
		}
	}

	// Plain queries also select the entity of every hop that has a column, so a cell can be traced
	// back to its entity (drill-down, fact identity). The root is always selected already.
	const entityVariables: Record<string, string> = agg ? {} : { root: 'root' };
	if (!agg) {
		for (const [i, h] of model.hops.entries()) {
			if (!model.columns.some((c) => c.hopId === h.id)) continue;
			select.push(`?h${i}`);
			entityVariables[h.id] = `h${i}`;
		}
	}

	const order: string[] = [];
	let groupClause = '';
	/** Aggregate expression per measure alias: SPARQL 1.1 cannot reference a select alias in HAVING. */
	const measureExpr = new Map<string, string>();
	if (agg) {
		const groupVars = agg.groupBy.map((g) => columnVar.get(g)!);
		// Select list follows the groupBy order, then the measures.
		for (const g of agg.groupBy) {
			const col = model.columns.find((c) => c.id === g)!;
			const v = columnVar.get(g)!;
			select.push(v);
			columns.push({ id: g, variable: v.slice(1), header: col.header });
		}
		for (const m of agg.measures) {
			const target = m.of === 'root' ? '?root' : columnVar.get(m.of)!;
			// sum/avg/min/max aggregate the typed column variable directly — no casting (validated).
			const fn = m.fn === 'countDistinct' ? `COUNT(DISTINCT ${target})` : `${m.fn.toUpperCase()}(${target})`;
			const alias = `?m_${m.alias}`;
			measureExpr.set(m.alias, fn);
			select.push(`(${fn} AS ${alias})`);
			columns.push({ id: m.alias, variable: alias.slice(1), header: m.alias });
			columnVar.set(m.alias, alias);
		}
		if (groupVars.length > 0) groupClause = `\nGROUP BY ${groupVars.join(' ')}`;
		const conditions = (agg.having ?? []).map((h) => {
			const expr = measureExpr.get(h.measure);
			if (expr === undefined || !Number.isFinite(h.value))
				throw new QueryCompileError(`HAVING refers to unknown measure ${h.measure}`);
			return `${expr} ${HAVING_OPERATORS[h.op]} ${h.value}`;
		});
		if (conditions.length > 0) groupClause += `\nHAVING(${conditions.join(' && ')})`;
		for (const s of model.sort) {
			order.push(`${s.direction === 'desc' ? 'DESC' : 'ASC'}(${columnVar.get(s.columnId)!})`);
		}
		const sorted = new Set(model.sort.map((s) => s.columnId));
		for (const g of agg.groupBy) if (!sorted.has(g)) order.push(columnVar.get(g)!);
	} else {
		for (const s of model.sort) {
			order.push(`${s.direction === 'desc' ? 'DESC' : 'ASC'}(${columnVar.get(s.columnId)!})`);
		}
		order.push('?root');
	}

	const where = [...required, ...filterClauses, ...optional].map((p) => `\t\t${p}`).join('\n');
	const body = `SELECT ${agg ? '' : 'DISTINCT '}${select.join(' ')}\nWHERE {\n${where}\n}${groupClause}`;
	return { body, order, columns, rowKind: agg ? 'aggregate' : 'facts', entityVariables };
}

function withOrder(built: BuiltQuery): string {
	const orderBy = built.order.length > 0 ? `\nORDER BY ${built.order.join(' ')}` : '';
	return `${PREFIXES}\n${built.body}${orderBy}`;
}

/** The query text without paging (only a model-level row `LIMIT`, if set) — for "Show SPARQL" and the console (STORY-193). */
export function compileUnpagedQuery(model: QueryModel, schema: BuilderSchema, opts: CompileOptions = {}): string {
	const text = withOrder(build(model, schema, opts));
	return model.limit === undefined ? text : `${text}\nLIMIT ${model.limit}`;
}

export function compileQuery(
	model: QueryModel,
	schema: BuilderSchema,
	page: PageRequest,
	opts: CompileOptions = {}
): CompiledQuery {
	const built = build(model, schema, opts);
	const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(page.limit) || 1));
	const offset = Math.max(0, Math.floor(page.offset) || 0);
	// A model-level row limit caps the total: shrink the page so offset+limit never passes it.
	const pageLimit = model.limit === undefined ? limit : Math.max(0, Math.min(limit, model.limit - offset));
	return {
		sparql: `${withOrder(built)}\nLIMIT ${pageLimit} OFFSET ${offset}`,
		columns: built.columns,
		rowKind: built.rowKind,
		entityVariables: built.entityVariables
	};
}

/**
 * `SELECT (COUNT(*) AS ?total)` over the un-paged query as a sub-select (research Q10), so the UI
 * can show the total next to a page. For aggregated models this counts groups.
 */
export function compileCountQuery(
	model: QueryModel,
	schema: BuilderSchema,
	opts: CompileOptions = {}
): { sparql: string } {
	const built = build(model, schema, opts);
	return {
		sparql: `${PREFIXES}\nSELECT (COUNT(*) AS ?total)\nWHERE {\n{\n${built.body}\n}\n}`
	};
}

/**
 * One filter as required triple patterns plus a boolean test. `exists` marks tests that are already a
 * (NOT) EXISTS group graph pattern and so are written `FILTER EXISTS {…}`, not `FILTER(…)`.
 */
interface FilterParts {
	triples: string[];
	test: string;
	exists: boolean;
}

/**
 * Ungrouped filters keep their flat, AND-ed form. Filters sharing an `orGroup` become one
 * `FILTER(m1 || m2 …)` at the position of the group's first member; a member that needs a property
 * triple is wrapped in `EXISTS { … FILTER(…) }` so the triple does not turn the OR into an AND.
 */
function compileFilters(
	model: QueryModel,
	schema: BuilderSchema,
	entityVar: (hopId: string | null) => string,
	scoped: (body: (g: string) => string) => string,
	opts: CompileOptions
): string[] {
	const out: string[] = [];
	const done = new Set<string>();
	for (const [i, f] of model.filters.entries()) {
		const parts = filterParts(f, i, entityVar(f.hopId), scoped, model, schema, opts);
		if (!f.orGroup) {
			out.push(...parts.triples, parts.exists ? `FILTER ${parts.test}` : `FILTER(${parts.test})`);
			continue;
		}
		if (done.has(f.orGroup)) continue;
		done.add(f.orGroup);
		const members = model.filters
			.map((m, j) => ({ m, j }))
			.filter(({ m }) => m.orGroup === f.orGroup)
			.map(({ m, j }) => {
				const p = j === i ? parts : filterParts(m, j, entityVar(m.hopId), scoped, model, schema, opts);
				if (p.triples.length === 0) return p.test;
				return `EXISTS { ${p.triples.join('\n\t\t\t')}\n\t\t\tFILTER(${p.test}) }`;
			});
		out.push(`FILTER(${members.join(' || ')})`);
	}
	return out;
}

function filterParts(
	f: Filter,
	index: number,
	entity: string,
	scoped: (body: (g: string) => string) => string,
	model: QueryModel,
	schema: BuilderSchema,
	opts: CompileOptions
): FilterParts {
	const v = `?f${index}`;
	const prop = f.propertyIri === null ? null : iriRef(f.propertyIri, 'property IRI');

	if (f.op === 'isEmpty' || f.op === 'isNotEmpty') {
		if (prop === null)
			throw new QueryCompileError(`Filter ${index}: "${f.op}" needs a property`);
		const exists = `{ ${scoped(() => `${entity} ${prop} ?x${index} .`)} }`;
		return { triples: [], test: `${f.op === 'isEmpty' ? 'NOT EXISTS' : 'EXISTS'} ${exists}`, exists: true };
	}

	if (isComparisonOp(f.op)) {
		// Validation has already proven: property present and declared, comparable datatype, valid
		// lexical form. The datatype comes from the schema, never from the model or user text.
		const datatype = propertyDatatype(model, schema, f.hopId, f.propertyIri!);
		let value = f.value;
		if (f.relativeTime !== undefined) {
			if (!opts.now)
				throw new QueryCompileError(`Filter ${index}: a relative time needs the current time (clock) to compile`);
			if (datatype === null) throw new QueryCompileError(`Filter ${index}: "${f.op}" needs a typed property`);
			value = resolveRelativeTime(f.relativeTime, opts.now, datatype);
		}
		if (prop === null || datatype === null || typeof value !== 'string')
			throw new QueryCompileError(`Filter ${index}: "${f.op}" needs a typed property and a value`);
		const operator = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
		return {
			triples: [scoped(() => `${entity} ${prop} ${v} .`)],
			test: `${v} ${operator} ${lit(value)}^^${iriRef(datatype, 'datatype IRI')}`,
			exists: false
		};
	}

	const triples: string[] = [];
	let subject = `STR(${entity})`;
	if (prop !== null) {
		triples.push(scoped(() => `${entity} ${prop} ${v} .`));
		subject = `STR(${v})`;
	}
	const values = Array.isArray(f.value) ? f.value : [f.value ?? ''];
	let test = '';
	switch (f.op) {
		case 'eq':
			test = `${subject} = ${lit(values[0])}`;
			break;
		case 'neq':
			test = `${subject} != ${lit(values[0])}`;
			break;
		case 'contains':
			test = `CONTAINS(LCASE(${subject}), LCASE(${lit(values[0])}))`;
			break;
		case 'in':
			test = `${subject} IN (${values.map(lit).join(', ')})`;
			break;
	}
	return { triples, test, exists: false };
}
