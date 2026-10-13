import { describe, it, expect } from 'vitest';
import {
	chipStyle,
	evaluateRules,
	isPaletteColor,
	matchRule,
	ruleCellStyle,
	PALETTE_COLORS,
	type ColumnRule
} from './column-rules';
import { rowRuleColor } from './column-rules-editor';
import {
	emptyQueryModel,
	parseQueryModel,
	resultKey,
	serializeQueryModel,
	validateQueryModel,
	type QueryModel
} from './query-model';

const rule = (
	columnId: string,
	op: 'eq' | 'contains' | 'isEmpty',
	color: ColumnRule['color'],
	value?: string
): ColumnRule => ({ columnId, match: value === undefined ? { op } : { op, value }, color });

describe('evaluateRules', () => {
	it('returns the colour of the first matching rule', () => {
		const rules = [rule('c1', 'eq', 'green', 'Production'), rule('c1', 'contains', 'red', 'Prod')];
		expect(evaluateRules(rules, 'c1', 'Production')).toBe('green');
	});

	it('falls through to a later rule when an earlier one does not match', () => {
		const rules = [rule('c1', 'eq', 'green', 'Production'), rule('c1', 'contains', 'red', 'Prod')];
		expect(evaluateRules(rules, 'c1', 'Pre-Production')).toBe('red');
	});

	it('returns undefined when nothing matches or there are no rules', () => {
		expect(evaluateRules([rule('c1', 'eq', 'green', 'Production')], 'c1', 'Test')).toBeUndefined();
		expect(evaluateRules([], 'c1', 'Production')).toBeUndefined();
		expect(evaluateRules(undefined, 'c1', 'Production')).toBeUndefined();
	});

	it('only applies rules for the given column', () => {
		const rules = [rule('c2', 'eq', 'green', 'Production')];
		expect(evaluateRules(rules, 'c1', 'Production')).toBeUndefined();
	});
});

describe('evaluateRules operators', () => {
	it('eq is case-insensitive (enumeration labels)', () => {
		const rules = [rule('c1', 'eq', 'green', 'Production')];
		expect(evaluateRules(rules, 'c1', 'production')).toBe('green');
		expect(evaluateRules(rules, 'c1', 'PRODUCTION')).toBe('green');
		expect(evaluateRules(rules, 'c1', 'Production2')).toBeUndefined();
	});

	it('contains is a case-insensitive substring match', () => {
		const rules = [rule('c1', 'contains', 'amber', 'legacy')];
		expect(evaluateRules(rules, 'c1', 'Old LEGACY system')).toBe('amber');
		expect(evaluateRules(rules, 'c1', 'modern')).toBeUndefined();
	});

	it('isEmpty matches unbound, null and empty/blank strings only', () => {
		const rules = [rule('c1', 'isEmpty', 'grey')];
		expect(evaluateRules(rules, 'c1', undefined)).toBe('grey');
		expect(evaluateRules(rules, 'c1', null)).toBe('grey');
		expect(evaluateRules(rules, 'c1', '')).toBe('grey');
		expect(evaluateRules(rules, 'c1', '   ')).toBe('grey');
		expect(evaluateRules(rules, 'c1', 'x')).toBeUndefined();
	});

	it('eq/contains never match an empty cell, and need a rule value', () => {
		expect(evaluateRules([rule('c1', 'contains', 'red', '')], 'c1', 'abc')).toBeUndefined();
		expect(evaluateRules([rule('c1', 'eq', 'red')], 'c1', 'abc')).toBeUndefined();
		expect(evaluateRules([rule('c1', 'eq', 'red', 'x')], 'c1', null)).toBeUndefined();
	});
});

const NS = 'http://example.org/ns';

function modelWith(columnRules: unknown[]): QueryModel {
	const m = emptyQueryModel(`${NS}#Application`, [NS]);
	m.columns = [{ id: 'c1', hopId: null, source: 'label', header: 'Name' }];
	m.columnRules = columnRules as ColumnRule[];
	return m;
}

describe('palette', () => {
	it('accepts only the fixed palette keys', () => {
		for (const c of PALETTE_COLORS) expect(isPaletteColor(c)).toBe(true);
		expect(isPaletteColor('#ff0000')).toBe(false);
		expect(isPaletteColor('red; background:url(x)')).toBe(false);
		expect(isPaletteColor(undefined)).toBe(false);
	});
});

describe('columnRules validation', () => {
	it('accepts valid rules on existing columns', () => {
		const m = modelWith([rule('c1', 'eq', 'green', 'Production'), rule('c1', 'isEmpty', 'grey')]);
		expect(validateQueryModel(m)).toEqual([]);
	});

	it('rejects a free-form colour string', () => {
		const m = modelWith([{ columnId: 'c1', match: { op: 'eq', value: 'x' }, color: '#ff0000' }]);
		const issues = validateQueryModel(m);
		expect(issues.map((i) => i.path)).toContain('columnRules[0].color');
	});

	it('rejects a rule that references an unknown column', () => {
		const m = modelWith([rule('nope', 'eq', 'green', 'x')]);
		expect(validateQueryModel(m).map((i) => i.path)).toContain('columnRules[0].columnId');
	});

	it('requires a value for eq and contains', () => {
		const m = modelWith([rule('c1', 'eq', 'green'), rule('c1', 'contains', 'red', '')]);
		const paths = validateQueryModel(m).map((i) => i.path);
		expect(paths).toContain('columnRules[0].match.value');
		expect(paths).toContain('columnRules[1].match.value');
	});

	it('parse rejects structurally malformed rules', () => {
		const m = modelWith([{ columnId: 'c1', color: 'green' }]);
		expect(parseQueryModel(JSON.stringify(m)).ok).toBe(false);
		const bad = modelWith([{ columnId: 'c1', match: { op: 'regex', value: 'x' }, color: 'green' }]);
		expect(parseQueryModel(JSON.stringify(bad)).ok).toBe(false);
	});
});

describe('columnRules round trip', () => {
	it('survives serialize/parse and still evaluates', () => {
		const rules = [rule('c1', 'eq', 'green', 'Production'), rule('c1', 'isEmpty', 'grey')];
		const parsed = parseQueryModel(serializeQueryModel(modelWith(rules)));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.model.columnRules).toEqual(rules);
		expect(evaluateRules(parsed.model.columnRules, 'c1', 'production')).toBe('green');
	});
});

describe('ruleCellStyle', () => {
	it('maps palette keys to theme tokens and ignores anything else', () => {
		expect(ruleCellStyle('green')).toBe('background:var(--rule-green-bg);color:var(--rule-green-fg)');
		expect(ruleCellStyle(undefined)).toBeUndefined();
		expect(ruleCellStyle('#f00' as never)).toBeUndefined();
	});
});

describe('chip and row rules', () => {
	const chipRule: ColumnRule = { ...rule('c1', 'eq', 'red', 'Klasse 1'), chip: true, row: true };

	it('matchRule returns the whole first matching rule, flags included', () => {
		expect(matchRule([chipRule], 'c1', 'Klasse 1')).toBe(chipRule);
		expect(matchRule([chipRule], 'c1', 'Klasse 2')).toBeUndefined();
	});

	it('chipStyle uses the saturated chip tokens and ignores unknown keys', () => {
		expect(chipStyle('red')).toBe('background:var(--rule-red-chip-bg);color:var(--rule-red-chip-fg)');
		expect(chipStyle('#f00' as never)).toBeUndefined();
	});

	it('rowRuleColor picks the first row rule that matches its own column in the row', () => {
		const rules: ColumnRule[] = [
			{ ...rule('status', 'eq', 'green', 'Up') },
			{ ...rule('klass', 'eq', 'red', 'Klasse 1'), row: true },
			{ ...rule('klass', 'eq', 'amber', 'Klasse 2'), row: true }
		];
		const cells = (klass: string) => [
			{ columnId: 'status', text: 'Up', rawValue: 'Up' },
			{ columnId: 'klass', text: klass, rawValue: klass }
		];
		expect(rowRuleColor(rules, cells('Klasse 1'))).toBe('red');
		expect(rowRuleColor(rules, cells('Klasse 2'))).toBe('amber');
		// A non-row rule never tints the row.
		expect(rowRuleColor(rules, cells('Klasse 3'))).toBeUndefined();
	});

	it('round-trips chip and row flags through the model and rejects non-boolean flags', () => {
		const m: QueryModel = { ...emptyQueryModel('http://x#C', ['http://x']), columnRules: [chipRule] };
		const back = parseQueryModel(serializeQueryModel(m));
		expect(back.ok && back.model.columnRules?.[0]).toMatchObject({ chip: true, row: true });
		const bad = JSON.parse(serializeQueryModel(m));
		bad.columnRules[0].chip = 'yes';
		expect(parseQueryModel(JSON.stringify(bad)).ok).toBe(false);
	});
});

describe('resultKey', () => {
	const base = emptyQueryModel('http://x#C', ['http://x']);
	it('ignores colour rules but sees column changes', () => {
		const withRules: QueryModel = { ...base, columnRules: [rule('c1', 'eq', 'red', 'x')] };
		expect(resultKey(withRules)).toBe(resultKey(base));
		const withColumn: QueryModel = {
			...base,
			columns: [{ id: 'c1', hopId: null, source: 'iri', header: 'IRI' }]
		};
		expect(resultKey(withColumn)).not.toBe(resultKey(base));
	});
});
