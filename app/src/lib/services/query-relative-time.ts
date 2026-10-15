/**
 * Relative time for comparison filters (STORY-233, option A): the model stores the expression
 * (`-24h`), and it is resolved against a clock *passed in* at run time — nothing here reads the
 * current time, so every function is pure and testable with a fixed `Date`. Units are seconds,
 * minutes, hours, days and weeks, all fixed-length and in UTC; snapping (`@d`) is deferred.
 */
import type { BuilderSchema } from './query-builder-schema';
import { XSD_DATE, XSD_DATETIME, propertyDatatype } from './query-datatypes';
import type { FilterOp, QueryModel } from './query-model';

/** `now`, or a signed whole number followed by one unit: `-24h`, `+1d`, `-90m`. */
const RELATIVE = /^(now|([+-])(\d{1,6})([smhdw]))$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 } as const;

export const isRelativeTime = (value: string): boolean => RELATIVE.test(value);

/** The lexical form of `expression` at `now`, typed for the property: a dateTime in UTC or a UTC date. */
export function resolveRelativeTime(expression: string, now: Date, datatype: string): string {
	const m = RELATIVE.exec(expression);
	if (!m) throw new Error(`"${expression}" is not a relative time such as -24h, +1d or now`);
	if (datatype !== XSD_DATETIME && datatype !== XSD_DATE)
		throw new Error(`Relative time needs a date or dateTime property, not ${datatype}`);
	const offset = m[1] === 'now' ? 0 : Number(m[3]) * UNIT_SECONDS[m[4] as keyof typeof UNIT_SECONDS] * (m[2] === '-' ? -1 : 1);
	const iso = new Date(Math.floor(now.getTime() / 1000) * 1000 + offset * 1000).toISOString();
	return datatype === XSD_DATE ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

export interface ResolvedRelativeFilter {
	filterId: string;
	/** Property label (or its IRI when the schema no longer declares it). */
	property: string;
	op: FilterOp;
	expression: string;
	resolved: string;
}

/** The time window a model's relative filters cover right now — shown next to a report's "as of". */
export function describeRelativeFilters(
	model: QueryModel,
	schema: BuilderSchema,
	now: Date
): ResolvedRelativeFilter[] {
	const labels = new Map<string, string>();
	for (const c of schema.classes.values()) for (const p of c.properties) labels.set(p.iri, p.label);
	const out: ResolvedRelativeFilter[] = [];
	for (const f of model.filters) {
		if (f.relativeTime === undefined || f.propertyIri === null) continue;
		const datatype = propertyDatatype(model, schema, f.hopId, f.propertyIri);
		if (datatype === null || !isRelativeTime(f.relativeTime)) continue;
		out.push({
			filterId: f.id,
			property: labels.get(f.propertyIri) ?? f.propertyIri,
			op: f.op,
			expression: f.relativeTime,
			resolved: resolveRelativeTime(f.relativeTime, now, datatype)
		});
	}
	return out;
}

const OP_SYMBOL: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

/** One line per resolved bound, e.g. `timestamp ≥ 2026-03-14T10:30:45Z (-24h)`. */
export function formatTimeWindow(w: ResolvedRelativeFilter): string {
	return `${w.property} ${OP_SYMBOL[w.op] ?? w.op} ${w.resolved} (${w.expression})`;
}
