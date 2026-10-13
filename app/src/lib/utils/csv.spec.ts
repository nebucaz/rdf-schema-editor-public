import { describe, it, expect } from 'vitest';
import { toCsv, neutraliseFormula, CSV_BOM } from './csv';

/** Minimal RFC 4180 parser, used only to prove `toCsv` output round-trips. */
function parseCsv(text: string): string[][] {
	const src = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
			else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') { row.push(field); field = ''; }
		else if (ch === '\r' && src[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
		else field += ch;
	}
	if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
	return rows;
}

describe('toCsv', () => {
	it('starts with the UTF-8 BOM, writes the header first and uses CRLF', () => {
		const out = toCsv(['A', 'B'], [['1', '2'], ['3', '4']]);
		expect(out.startsWith('﻿')).toBe(true);
		expect(out.slice(1)).toBe('A,B\r\n1,2\r\n3,4\r\n');
	});

	it('quotes fields with comma, quote, CR or LF and doubles embedded quotes', () => {
		const out = toCsv(['h'], [['a,b'], ['say "hi"'], ['line1\nline2'], ['cr\rcr']]);
		expect(out).toContain('"a,b"');
		expect(out).toContain('"say ""hi"""');
		expect(out).toContain('"line1\nline2"');
		expect(out).toContain('"cr\rcr"');
	});

	it('does not quote plain fields', () => {
		expect(toCsv(['h'], [['plain text']]).slice(1)).toBe('h\r\nplain text\r\n');
	});

	it('round-trips commas, quotes, newlines, unicode and empty cells', () => {
		const rows = [
			['Müller, Anna', 'say "hi"', 'a\nb'],
			['日本語', '', 'ünï'],
			['', '', '']
		];
		const header = ['Name', 'Quote', 'Text'];
		expect(parseCsv(toCsv(header, rows))).toEqual([header, ...rows]);
	});

	it('writes only the header for no rows', () => {
		expect(toCsv(['A'], []).slice(1)).toBe('A\r\n');
	});

	it('neutralises formula-looking cells and still round-trips them as text', () => {
		const out = parseCsv(toCsv(['h'], [['=SUM(A1)'], ['+cmd'], ['-cmd'], ['@x'], ['\tx'], ['\rx']]));
		expect(out.slice(1).map((r) => r[0])).toEqual(["'=SUM(A1)", "'+cmd", "'-cmd", "'@x", "'\tx", "'\rx"]);
	});

	it('neutralises header cells too', () => {
		expect(parseCsv(toCsv(['=evil'], []))[0]).toEqual(["'=evil"]);
	});
});

describe('neutraliseFormula', () => {
	it.each([['='], ['+'], ['-'], ['@'], ['\t'], ['\r']])('prefixes a leading %j', (c) => {
		expect(neutraliseFormula(`${c}x`)).toBe(`'${c}x`);
	});
	it('leaves ordinary text alone', () => {
		expect(neutraliseFormula('hello')).toBe('hello');
		expect(neutraliseFormula('a=b')).toBe('a=b');
		expect(neutraliseFormula('')).toBe('');
	});
	it('leaves plain numbers (including negatives) untouched so numeric data stays numeric', () => {
		for (const n of ['-5', '+5', '-3.25', '-1e9', '42', '0.5']) expect(neutraliseFormula(n)).toBe(n);
	});
	it('still neutralises number-looking text that could be a formula', () => {
		expect(neutraliseFormula('-5+cmd|x')).toBe("'-5+cmd|x");
		expect(neutraliseFormula('-')).toBe("'-");
	});
});
