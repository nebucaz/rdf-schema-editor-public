import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	groupFindings,
	summarize,
	valueCell,
	findingKey,
	type ValidationFinding
} from './validation-report-model.js';

function finding(over: Partial<ValidationFinding> = {}): ValidationFinding {
	return {
		individualIri: 'http://ex#a',
		individualLabel: 'a',
		typeIri: 'http://ex#T',
		path: 'http://ex#p',
		constraint: 'minCount',
		message: 'm',
		ruleId: 'R-1',
		qualityDimension: 'Completeness',
		shapeIri: 'http://ex#S',
		...over
	};
}

const expectedFile = JSON.parse(
	readFileSync(fileURLToPath(new URL('../../../../examples/itam-shapes/itam-expected.json', import.meta.url)), 'utf8')
) as { findings: { individual: string; ruleId: string; constraint: string; path: string; value?: string }[] };

/** The 22 ITAM findings as report rows; the label is the record name (R11 ...). */
const itam: ValidationFinding[] = expectedFile.findings.map((f) => {
	const record = f.individual.split('#')[1];
	return finding({
		individualIri: f.individual,
		individualLabel: record,
		ruleId: f.ruleId,
		constraint: f.constraint,
		path: f.path,
		qualityDimension: f.ruleId.includes('UNIQUE') ? 'Uniqueness' : 'Completeness',
		...(f.value === undefined ? {} : { value: f.value })
	});
});

describe('groupFindings - identity', () => {
	it('makes one group per identity, most findings first, then label ascending', () => {
		const groups = groupFindings(itam, 'identity');
		expect(groups).toHaveLength(18);
		expect(groups.map((g) => g.title).slice(0, 3)).toEqual(['R11', 'R12', 'R26']);
		expect(groups.map((g) => g.findings.length).slice(0, 3)).toEqual([3, 2, 2]);
		expect(groups.slice(3).every((g) => g.findings.length === 1)).toBe(true);
		expect(groups.slice(3).map((g) => g.title)).toEqual([...groups.slice(3).map((g) => g.title)].sort());
	});

	it('keys a group by the identity IRI and keeps its findings together', () => {
		const r11 = groupFindings(itam, 'identity')[0];
		expect(r11.key).toBe('https://lida.pnet.ch/arm#R11');
		expect(r11.findings.every((f) => f.individualIri === r11.key)).toBe(true);
	});

	it('breaks a tie on the count by label, case-insensitively', () => {
		const groups = groupFindings(
			[finding({ individualIri: 'http://ex#2', individualLabel: 'beta' }), finding({ individualIri: 'http://ex#1', individualLabel: 'Alpha' })],
			'identity'
		);
		expect(groups.map((g) => g.title)).toEqual(['Alpha', 'beta']);
	});
});

describe('groupFindings - rule', () => {
	it('sorts by rule id and puts findings without one last under "No rule id"', () => {
		const groups = groupFindings(
			[finding({ ruleId: 'B' }), finding({ ruleId: '' }), finding({ ruleId: 'A' }), finding({ ruleId: 'B' })],
			'rule'
		);
		expect(groups.map((g) => g.title)).toEqual(['A', 'B', 'No rule id']);
		expect(groups[1].findings).toHaveLength(2);
	});
});

describe('groupFindings - dimension', () => {
	it('sorts named dimensions alphabetically and "Unspecified" last', () => {
		const groups = groupFindings(
			[
				finding({ qualityDimension: '' }),
				finding({ qualityDimension: 'Uniqueness' }),
				finding({ qualityDimension: '  ' }),
				finding({ qualityDimension: 'Completeness' })
			],
			'dimension'
		);
		expect(groups.map((g) => g.title)).toEqual(['Completeness', 'Uniqueness', 'Unspecified']);
		expect(groups[2].findings).toHaveLength(2);
	});
});

describe('groupFindings - none', () => {
	it('returns a single group in the incoming order', () => {
		const rows = [finding({ individualIri: 'http://ex#z' }), finding({ individualIri: 'http://ex#a' })];
		const groups = groupFindings(rows, 'none');
		expect(groups).toHaveLength(1);
		expect(groups[0].findings).toEqual(rows);
	});

	it('returns no group for no findings, in every view', () => {
		for (const view of ['identity', 'rule', 'dimension', 'none'] as const) {
			expect(groupFindings([], view)).toEqual([]);
		}
	});
});

describe('summarize', () => {
	it('counts findings, distinct identities, per rule and per dimension', () => {
		const s = summarize(itam);
		expect(s.findings).toBe(22);
		expect(s.identities).toBe(18);
		expect(s.byRule.reduce((n, r) => n + r.count, 0)).toBe(22);
		expect(s.byRule.find((r) => r.ruleId === 'AC-NAME-FORMAT-MODUL')?.count).toBe(6);
		expect(s.byDimension.reduce((n, d) => n + d.count, 0)).toBe(22);
	});

	it('is all zero for no findings', () => {
		expect(summarize([])).toEqual({ findings: 0, identities: 0, byRule: [], byDimension: [] });
	});
});

describe('valueCell', () => {
	it('is "none" when there is no value', () => {
		expect(valueCell(finding({ constraint: 'minCount' }))).toEqual({ kind: 'none', text: '' });
	});

	it('keeps an empty and a whitespace-only value, as literals', () => {
		expect(valueCell(finding({ constraint: 'minLength', value: '' }))).toEqual({ kind: 'literal', text: '' });
		expect(valueCell(finding({ constraint: 'pattern', value: '  ' }))).toEqual({ kind: 'literal', text: '  ' });
	});

	it('marks a datatype finding and a class finding for CURIE display', () => {
		expect(valueCell(finding({ constraint: 'datatype', value: 'http://www.w3.org/2001/XMLSchema#integer' })).kind).toBe('datatype');
		expect(valueCell(finding({ constraint: 'class', value: 'http://ex#x' })).kind).toBe('iri');
	});

	it('treats a sparql value as a literal, even when it is an IRI text', () => {
		expect(valueCell(finding({ constraint: 'sparql', value: 'A-77' }))).toEqual({ kind: 'literal', text: 'A-77' });
	});
});

describe('findingKey', () => {
	it('ignores value, message and label', () => {
		const a = finding({ value: 'x', message: 'one', individualLabel: 'A' });
		const b = finding({ value: 'y', message: 'two', individualLabel: 'B', typeIri: 'http://ex#Other', shapeIri: 'http://ex#Z' });
		expect(findingKey(a)).toBe(findingKey(b));
	});

	it('differs when individual, rule, path or constraint differ', () => {
		const base = findingKey(finding());
		for (const over of [{ individualIri: 'http://ex#b' }, { ruleId: 'R-2' }, { path: 'http://ex#q' }, { constraint: 'maxCount' }]) {
			expect(findingKey(finding(over))).not.toBe(base);
		}
	});

	it('is unique across the 22 ITAM findings', () => {
		expect(new Set(itam.map(findingKey)).size).toBe(22);
	});
});
