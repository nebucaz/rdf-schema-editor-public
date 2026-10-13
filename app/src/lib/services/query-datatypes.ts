/**
 * Datatype helpers for typed query literals (SPL input, STORY-212). Pure.
 *
 * A comparison or numeric measure uses the datatype of the *property* (from the builder schema), never
 * anything the user typed. The user's value is only ever a lexical form, and `lexicalFormError` is the
 * injection guard that runs before it can be placed in a query string.
 */
import type { BuilderSchema } from './query-builder-schema';
import type { Filter, QueryModel } from './query-model';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
export const XSD_INTEGER = `${XSD}integer`;
export const XSD_DECIMAL = `${XSD}decimal`;
export const XSD_DOUBLE = `${XSD}double`;
export const XSD_FLOAT = `${XSD}float`;
export const XSD_DATE = `${XSD}date`;
export const XSD_DATETIME = `${XSD}dateTime`;

const NUMERIC = new Set([XSD_INTEGER, XSD_DECIMAL, XSD_DOUBLE, XSD_FLOAT]);
const TEMPORAL = new Set([XSD_DATE, XSD_DATETIME]);

export const isNumericDatatype = (dt: string): boolean => NUMERIC.has(dt);
export const isTemporalDatatype = (dt: string): boolean => TEMPORAL.has(dt);
/** Datatypes that support `>`, `>=`, `<`, `<=`. */
export const isComparableDatatype = (dt: string): boolean => NUMERIC.has(dt) || TEMPORAL.has(dt);

const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const FLOATING = /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|[+-]?INF|NaN)$/;
const DATE = /^(-?\d{4,})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/;
const DATETIME = /^(-?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

function validCalendarDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1) return false;
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return day <= days;
}

function validOffset(zone: string | undefined): boolean {
	if (!zone || zone === 'Z') return true;
	const [h, m] = zone.slice(1).split(':').map(Number);
	return h < 14 || (h === 14 && m === 0) ? m <= 59 : false;
}

/** `null` when `value` is a valid lexical form of `datatype`, otherwise a human-readable reason. */
export function lexicalFormError(datatype: string, value: string): string | null {
	const bad = (what: string) => `"${value.length > 40 ? `${value.slice(0, 40)}…` : value}" is not a valid ${what}`;
	switch (datatype) {
		case XSD_INTEGER:
			return INTEGER.test(value) ? null : bad('integer');
		case XSD_DECIMAL:
			return DECIMAL.test(value) ? null : bad('decimal number');
		case XSD_DOUBLE:
		case XSD_FLOAT:
			return FLOATING.test(value) ? null : bad('number');
		case XSD_DATE: {
			const m = DATE.exec(value);
			return m && validCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) && validOffset(m[4])
				? null
				: bad('date (YYYY-MM-DD)');
		}
		case XSD_DATETIME: {
			const m = DATETIME.exec(value);
			const ok =
				m !== null &&
				validCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) &&
				Number(m[4]) <= 23 &&
				Number(m[5]) <= 59 &&
				Number(m[6]) <= 59 &&
				validOffset(m[8]);
			return ok ? null : bad('date-time (YYYY-MM-DDThh:mm:ss, optional Z or offset)');
		}
		default:
			return `Datatype ${datatype} does not support typed comparison`;
	}
}

/** Class whose properties a filter on `hopId` can address: the root or the hop's target class. */
function classOfHop(model: QueryModel, hopId: string | null): string {
	if (hopId === null) return model.root.classIri;
	return model.hops.find((h) => h.id === hopId)?.targetClassIri ?? '';
}

/**
 * Datatype IRI of a property as seen from a hop's class (or its subclasses, which hold the property
 * when the root is subclass-inclusive). `null` when the schema does not declare it there.
 */
export function propertyDatatype(
	model: QueryModel,
	schema: BuilderSchema,
	hopId: string | null,
	propertyIri: string
): string | null {
	const cls = schema.classes.get(classOfHop(model, hopId));
	if (!cls) return null;
	const candidates = [cls, ...cls.subclasses.map((s) => schema.classes.get(s)).filter((c) => c !== undefined)];
	for (const c of candidates) {
		const p = c.properties.find((x) => x.iri === propertyIri);
		if (p) return p.datatype;
	}
	return null;
}

export const COMPARISON_OPS = ['gt', 'gte', 'lt', 'lte'] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];
export const isComparisonOp = (op: Filter['op']): op is ComparisonOp =>
	(COMPARISON_OPS as readonly string[]).includes(op);
