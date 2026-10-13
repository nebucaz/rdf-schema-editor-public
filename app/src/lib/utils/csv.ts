/**
 * Client-side CSV writer for the Query Workbench export (STORY-194, research Q9). RFC 4180:
 * comma separators, CRLF line ends, fields containing `,` `"` CR or LF are quoted with embedded
 * quotes doubled. A UTF-8 BOM is prefixed so Excel detects the encoding.
 *
 * Formula injection: graph data is user- or sync-controlled, and a cell beginning with `=`, `+`,
 * `-`, `@`, TAB or CR is executed as a formula by spreadsheet apps. Such cells get a leading `'`
 * (the spreadsheet convention that forces text). A string that is a plain number (`-5`, `+3.2`,
 * `1e9`) cannot execute anything, so it is left as-is rather than corrupting numeric data.
 */

export const CSV_BOM = '﻿';

const PLAIN_NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseFormula(value: string): string {
	if (!FORMULA_START.test(value)) return value;
	return PLAIN_NUMBER.test(value) ? value : `'${value}`;
}

function field(value: string): string {
	const safe = neutraliseFormula(value);
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(columns: string[], rows: string[][]): string {
	const lines = [columns, ...rows].map((r) => r.map(field).join(','));
	return `${CSV_BOM}${lines.join('\r\n')}\r\n`;
}
