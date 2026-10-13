/**
 * Pure helpers behind the workbench result table (STORY-192): paging math, turning SPARQL-JSON rows
 * into display cells, and the single place that decides which cells stand for one fact (`cellFact`).
 * No Svelte, no GraphDB — the table only renders what this returns.
 */
import { MAX_PAGE_SIZE, type CompiledQuery } from './query-compiler';
import type { Column, QueryModel } from './query-model';
import type { SparqlBinding, SparqlSelectResults } from './sparql-connector';
import { XSD_NAMESPACE, extractLocalName } from '../utils/iri';
import { buildIdentitySearchUrl } from '../utils/identity-search-url';

type Binding = SparqlBinding[string];

// ── Paging ──────────────────────────────────────────────────────────────────

export const PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 50;

export function clampPageSize(n: number): number {
	if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_SIZE;
	return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}

export interface PageInfo {
	/** 1-based first row on the page; 0 when there are no rows. */
	from: number;
	to: number;
	total: number;
	hasPrev: boolean;
	hasNext: boolean;
	nextOffset: number;
	prevOffset: number;
	/** Set only when a row limit cut the result short: the number of rows the query matches. */
	uncappedTotal?: number;
}

/**
 * `rawTotal` is the count query's result; `rowLimit` (the model's `limit`) caps what is shown, so
 * `total` is `min(rawTotal, rowLimit)` and paging stops there.
 */
export function pageInfo(rawTotal: number, offset: number, limit: number, rowLimit?: number): PageInfo {
	const total = rowLimit === undefined ? rawTotal : Math.min(rawTotal, rowLimit);
	const safeOffset = Math.max(0, offset);
	const to = Math.min(total, safeOffset + limit);
	return {
		from: total === 0 || safeOffset >= total ? 0 : safeOffset + 1,
		to: safeOffset >= total ? 0 : to,
		total,
		hasPrev: safeOffset > 0,
		hasNext: safeOffset + limit < total,
		nextOffset: safeOffset + limit,
		prevOffset: Math.max(0, safeOffset - limit),
		...(total < rawTotal ? { uncappedTotal: rawTotal } : {})
	};
}

// ── Cells ───────────────────────────────────────────────────────────────────

/** The one fact a cell stands for; annotations (STORY-199/200) attach to this. */
export interface CellFact {
	subjectIri: string;
	predicateIri: string;
	/** Literal datatype / language tag — facts match on both, so they travel with the value. */
	object: { value: string; isIri: boolean; datatype?: string; lang?: string };
}

/**
 * Default cell → fact rule (research Q5; multi-valued/aggregated mapping is deferred and would
 * change only this function): a property column's cell is (entity of the column's hop, the column's
 * property, the cell value). Aggregate rows, label/IRI columns, measures and empty cells have none.
 */
export function cellFact(input: {
	rowKind: CompiledQuery['rowKind'];
	column: Column | undefined;
	subjectIri: string | undefined;
	value: Binding | undefined;
}): CellFact | undefined {
	const { rowKind, column, subjectIri, value } = input;
	if (rowKind === 'aggregate' || !column || typeof column.source === 'string') return undefined;
	if (!subjectIri || !value) return undefined;
	return {
		subjectIri,
		predicateIri: column.source.propertyIri,
		object: {
			value: value.value,
			isIri: value.type === 'uri',
			...(value.datatype ? { datatype: value.datatype } : {}),
			...(value['xml:lang'] ? { lang: value['xml:lang'] } : {})
		}
	};
}

export function formatLiteral(binding: Binding): string {
	if (binding.type !== 'literal') return binding.value;
	const dt = binding.datatype?.startsWith(XSD_NAMESPACE) ? extractLocalName(binding.datatype) : null;
	if (dt === 'boolean') return binding.value === 'true' || binding.value === '1' ? 'Yes' : 'No';
	if (dt === 'dateTime') {
		const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z)?/.exec(binding.value);
		if (m) return `${m[1]} ${m[2]}${m[3] ? ' UTC' : ''}`;
	}
	return binding.value;
}

export interface ResultCell {
	columnId: string;
	header: string;
	text: string;
	/** The binding's unformatted value (`''` when unbound) — what the CSV export writes for literals. */
	rawValue: string;
	/** Full IRI behind a shortened IRI cell. */
	title?: string;
	/** `/identities` resource page of the entity this cell names. */
	href?: string;
	fact?: CellFact;
	/** Measure (COUNT) cell — right-aligned numeric in the table. */
	isMeasure: boolean;
}

export interface ResultRows {
	headers: string[];
	rows: ResultCell[][];
}

const drillDownHref = (iri: string) => buildIdentitySearchUrl({ node: iri });

export function buildResultRows(
	model: QueryModel,
	compiled: CompiledQuery,
	results: SparqlSelectResults
): ResultRows {
	const modelColumn = new Map(model.columns.map((c) => [c.id, c]));
	const entityVar = (hopId: string | null): string | undefined =>
		compiled.entityVariables[hopId ?? 'root'];

	const rows = results.results.bindings.map((row) => {
		// Label of each hop's entity (when it has a label column) so IRI cells can show a name.
		const labelOfHop = new Map<string | null, string>();
		for (const cc of compiled.columns) {
			const mc = modelColumn.get(cc.id);
			const b = row[cc.variable];
			if (mc && mc.source === 'label' && b) labelOfHop.set(mc.hopId, b.value);
		}

		return compiled.columns.map((cc): ResultCell => {
			const mc = modelColumn.get(cc.id);
			const binding: Binding | undefined = row[cc.variable];
			const base = {
				columnId: cc.id,
				header: cc.header,
				isMeasure: mc === undefined,
				rawValue: binding?.value ?? ''
			};
			if (!binding) return { ...base, text: '' };
			if (!mc) return { ...base, text: binding.value };

			const subjectIri = row[entityVar(mc.hopId) ?? '']?.value;
			if (mc.source === 'label') {
				return {
					...base,
					text: binding.value,
					...(subjectIri ? { href: drillDownHref(subjectIri) } : {})
				};
			}
			if (mc.source === 'iri') {
				return {
					...base,
					text: labelOfHop.get(mc.hopId) ?? extractLocalName(binding.value),
					title: binding.value,
					href: drillDownHref(binding.value)
				};
			}
			const fact = cellFact({ rowKind: compiled.rowKind, column: mc, subjectIri, value: binding });
			return binding.type === 'uri'
				? { ...base, text: extractLocalName(binding.value), title: binding.value, fact }
				: { ...base, text: formatLiteral(binding), fact };
		});
	});
	return { headers: compiled.columns.map((c) => c.header), rows };
}

/** A plain-language message for a failed query; never throws. */
export function readableQueryError(e: unknown): string {
	const message = e instanceof Error ? e.message : '';
	if (/time(d)?[\s-]?out/i.test(message)) {
		return 'The query took too long and was stopped. Narrow it with a filter, remove a relationship, or reduce the namespaces in scope.';
	}
	return message || 'The query failed.';
}
