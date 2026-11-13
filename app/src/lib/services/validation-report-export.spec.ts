import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ValidationFinding } from './validation-report-model.js';
import {
	reportToCsv,
	reportToJson,
	reportToMarkdown,
	exportFilename,
	type ReportExportInput
} from './validation-report-export.js';

function finding(over: Partial<ValidationFinding> = {}): ValidationFinding {
	return {
		individualIri: 'http://ns#a',
		individualLabel: 'Anna',
		typeIri: 'http://ns#Person',
		path: 'http://ns#name',
		constraint: 'pattern',
		message: 'm',
		ruleId: 'R-1',
		qualityDimension: 'Format',
		shapeIri: 'http://ns#S',
		...over
	};
}

const runAt = new Date('2026-11-13T09:30:00Z');
const input = (over: Partial<ReportExportInput> = {}): ReportExportInput => ({
	findings: [finding()],
	notChecked: [],
	view: 'identity',
	runAt,
	appVersion: '1.4.0',
	hiddenNamespaces: [],
	...over
});

/** Minimal RFC 4180 reader (BOM, quotes, CRLF) so the round trip is checked, not the writer's own format. */
function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quoted) {
			if (c === '"' && src[i + 1] === '"') (cell += '"'), i++;
			else if (c === '"') quoted = false;
			else cell += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') (row.push(cell), (cell = ''));
		else if (c === '\r') continue;
		else if (c === '\n') (row.push(cell), rows.push(row), (row = []), (cell = ''));
		else cell += c;
	}
	return rows;
}

const itamFile = JSON.parse(
	readFileSync(fileURLToPath(new URL('../../../../examples/itam-shapes/itam-expected.json', import.meta.url)), 'utf8')
) as { findings: { individual: string; ruleId: string; constraint: string; path: string; value?: string }[] };
const itam: ValidationFinding[] = itamFile.findings.map((f) =>
	finding({
		individualIri: f.individual,
		individualLabel: f.individual.split('#')[1],
		ruleId: f.ruleId,
		constraint: f.constraint,
		path: f.path,
		...(f.value === undefined ? {} : { value: f.value })
	})
);

describe('reportToCsv', () => {
	it('has the header, one row per finding and one per not-checked constraint', () => {
		const rows = parseCsv(
			reportToCsv(input({ notChecked: [{ shapeIri: 'http://ns#S2', ruleId: 'R-9', construct: 'sh:in', reason: 'not supported' }] }))
		);
		expect(rows[0]).toEqual(['kind', 'identity', 'label', 'type', 'rule', 'dimension', 'path', 'constraint', 'value', 'message', 'shape']);
		expect(rows).toHaveLength(3);
		expect(rows[1]).toEqual(['finding', 'http://ns#a', 'Anna', 'http://ns#Person', 'R-1', 'Format', 'http://ns#name', 'pattern', '', 'm', 'http://ns#S']);
		expect(rows[2]).toEqual(['notChecked', '', '', '', 'R-9', '', '', 'sh:in', '', 'not supported', 'http://ns#S2']);
	});

	it('starts with the BOM and uses CRLF', () => {
		const csv = reportToCsv(input());
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('\r\n');
	});

	it('neutralises values that spreadsheets would run as formulas', () => {
		for (const value of ['=1+1', '+cmd', '-x', '@SUM(A1)']) {
			const rows = parseCsv(reportToCsv(input({ findings: [finding({ value })] })));
			expect(rows[1][8]).toBe(`'${value}`);
		}
	});

	it('keeps a whitespace-only value and writes no value for an empty one', () => {
		const rows = parseCsv(reportToCsv(input({ findings: [finding({ value: '  ' }), finding({ value: '' })] })));
		expect(rows[1][8]).toBe('  ');
		expect(rows[2][8]).toBe('');
	});

	it('is flat whatever the view', () => {
		const a = reportToCsv(input({ view: 'identity' }));
		expect(reportToCsv(input({ view: 'rule' }))).toBe(a);
	});
});

describe('reportToJson', () => {
	it('parses back to the same findings with value, plus meta, counts, filter and notChecked', () => {
		const nc = [{ shapeIri: 'http://ns#S2', ruleId: 'R-9', construct: 'sh:in', reason: 'r' }];
		const findings = [finding({ value: '' }), finding({ individualIri: 'http://ns#b', constraint: 'minCount' })];
		const parsed = JSON.parse(reportToJson(input({ findings, notChecked: nc, view: 'rule', hiddenNamespaces: ['http://other'] })));
		expect(parsed).toEqual({
			generatedAt: '2026-11-13T09:30:00.000Z',
			appVersion: '1.4.0',
			view: 'rule',
			counts: { findings: 2, identities: 2 },
			filter: { hiddenNamespaces: ['http://other'] },
			violations: findings,
			notChecked: nc
		});
		expect(parsed.violations[0].value).toBe('');
		expect('value' in parsed.violations[1]).toBe(false);
	});
});

describe('reportToMarkdown', () => {
	const rows = [
		finding({ individualIri: 'http://ns#a', individualLabel: 'Anna', ruleId: 'R-1', value: 'A-77' }),
		finding({ individualIri: 'http://ns#b', individualLabel: 'Bob', ruleId: 'R-1', value: '' }),
		finding({ individualIri: 'http://ns#b', individualLabel: 'Bob', ruleId: 'R-2', constraint: 'minCount', qualityDimension: 'Completeness' })
	];

	it('has a title and a meta block with run time, version, counts and filter', () => {
		const md = reportToMarkdown(input({ findings: rows, hiddenNamespaces: ['http://other'] }));
		expect(md).toMatch(/^# Validation report/);
		expect(md).toContain('2026-11-13T09:30:00.000Z');
		expect(md).toContain('1.4.0');
		expect(md).toContain('3 findings in 2 identities');
		expect(md).toContain('http://other');
	});

	it('follows the identity view: a section per identity, most findings first', () => {
		const md = reportToMarkdown(input({ findings: rows, view: 'identity' }));
		expect(md.indexOf('### Bob')).toBeGreaterThan(-1);
		expect(md.indexOf('### Bob')).toBeLessThan(md.indexOf('### Anna'));
		expect(md).toContain('2 findings');
	});

	it('follows the rule view', () => {
		const md = reportToMarkdown(input({ findings: rows, view: 'rule' }));
		expect(md).toContain('### R-1 (2)');
		expect(md).toContain('### R-2 (1)');
	});

	it('follows the dimension view', () => {
		const md = reportToMarkdown(input({ findings: rows, view: 'dimension' }));
		expect(md.indexOf('### Completeness (1)')).toBeLessThan(md.indexOf('### Format (2)'));
	});

	it('follows the flat view with one table', () => {
		const md = reportToMarkdown(input({ findings: rows, view: 'none' }));
		expect(md).not.toContain('### ');
		expect(md.match(/^\| Anna /gm)).toHaveLength(1);
	});

	it('quotes literal values so empty and blank ones are visible', () => {
		const md = reportToMarkdown(input({ findings: [finding({ value: '' }), finding({ value: '  ', ruleId: 'R-2' })], view: 'none' }));
		expect(md).toContain('""');
		expect(md).toContain('"  "');
	});

	it('escapes pipes and newlines in cells and writes no raw HTML', () => {
		const md = reportToMarkdown(input({ findings: [finding({ message: 'a | b\nc <script>', value: 'x|y' })], view: 'none' }));
		const row = md.split('\n').find((l) => l.startsWith('| Anna'))!;
		expect(row).toContain('a \\| b c');
		expect(row).toContain('x\\|y');
		expect(row).not.toContain('<script>');
	});

	it('lists notChecked even when there are no findings', () => {
		const md = reportToMarkdown(
			input({ findings: [], notChecked: [{ shapeIri: 'http://ns#S2', ruleId: 'R-9', construct: 'sh:in', reason: 'not supported' }] })
		);
		expect(md).toContain('R-9');
		expect(md).toContain('not supported');
		expect(md).toContain('0 findings in 0 identities');
	});
});

describe('the 22 ITAM findings', () => {
	it('give 22 rows, 22 entries and 22 table lines', () => {
		expect(parseCsv(reportToCsv(input({ findings: itam })))).toHaveLength(23);
		expect(JSON.parse(reportToJson(input({ findings: itam }))).violations).toHaveLength(22);
		const md = reportToMarkdown(input({ findings: itam, view: 'none' }));
		expect(md.split('\n').filter((l) => /^\| R\d\d /.test(l))).toHaveLength(22);
	});
});

describe('exportFilename', () => {
	it('follows validation-report-<date>.<ext>', () => {
		expect(exportFilename('csv', runAt)).toBe('validation-report-2026-11-13.csv');
		expect(exportFilename('json', runAt)).toBe('validation-report-2026-11-13.json');
		expect(exportFilename('md', runAt)).toBe('validation-report-2026-11-13.md');
	});
});
