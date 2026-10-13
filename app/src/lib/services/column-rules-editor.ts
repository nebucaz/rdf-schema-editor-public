/**
 * Pure rules behind the builder's "Formatting" panel (STORY-197): editing the ordered rule list and
 * deciding which values a column offers. The component renders what these return; the evaluator
 * itself stays in `column-rules.ts`, shared with the report.
 */
import { matchRule, type ColumnRule, type PaletteColor } from './column-rules';
import type { Column, QueryModel } from './query-model';
import type { BuilderSchema, BuilderValue } from './query-builder-schema';

export function addRule(rules: readonly ColumnRule[] | undefined, rule: ColumnRule): ColumnRule[] {
	return [...(rules ?? []), rule];
}

export function removeRule(rules: readonly ColumnRule[] | undefined, index: number): ColumnRule[] {
	return (rules ?? []).filter((_, i) => i !== index);
}

export function updateRule(
	rules: readonly ColumnRule[] | undefined,
	index: number,
	rule: ColumnRule
): ColumnRule[] {
	return (rules ?? []).map((r, i) => (i === index ? rule : r));
}

/** Rules are first-match-wins, so order is meaningful; ends of the list are a no-op. */
export function moveRule(
	rules: readonly ColumnRule[] | undefined,
	index: number,
	delta: -1 | 1
): ColumnRule[] {
	const list = [...(rules ?? [])];
	const to = index + delta;
	if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
	[list[index], list[to]] = [list[to], list[index]];
	return list;
}

/** Like `moveRule`, but swaps with the nearest rule of the *same column* so other columns' order is untouched. */
export function moveRuleWithinColumn(
	rules: readonly ColumnRule[] | undefined,
	index: number,
	delta: -1 | 1
): ColumnRule[] {
	const list = [...(rules ?? [])];
	const current = list[index];
	if (!current) return list;
	for (let i = index + delta; i >= 0 && i < list.length; i += delta) {
		if (list[i].columnId === current.columnId) {
			[list[index], list[i]] = [list[i], list[index]];
			return list;
		}
	}
	return list;
}

/** One column's rules with their index in the full list, so edits address the stored order. */
export function rulesForColumn(
	rules: readonly ColumnRule[] | undefined,
	columnId: string
): { index: number; rule: ColumnRule }[] {
	return (rules ?? []).flatMap((rule, index) => (rule.columnId === columnId ? [{ index, rule }] : []));
}

/**
 * The fixed set of values a column can take, when it is an enumeration: the members of an
 * enumerated class (label/IRI columns) or a property's `sh:in` list. `undefined` = free text.
 * `value` is what a rule stores — the displayed label for a label column, else the raw value.
 */
export function enumerationValuesForColumn(
	model: QueryModel,
	schema: BuilderSchema,
	column: Column
): BuilderValue[] | undefined {
	const hop = column.hopId === null ? null : model.hops.find((h) => h.id === column.hopId);
	const cls = schema.classes.get(hop ? hop.targetClassIri : model.root.classIri);
	if (!cls) return undefined;

	if (typeof column.source === 'string') {
		if (!cls.isEnumeration) return undefined;
		return column.source === 'label'
			? cls.members.map((m) => ({ value: m.label, label: m.label, isIri: false }))
			: cls.members;
	}
	const { propertyIri } = column.source;
	const allowed = cls.properties.find((p) => p.iri === propertyIri)?.allowedValues;
	return allowed && allowed.length > 0 ? allowed : undefined;
}

type RuleCell = { columnId: string; text: string; rawValue: string };

/** The rule that styles one result cell: matches the text the user sees first, then the raw value. */
export function cellRule(
	rules: readonly ColumnRule[] | undefined,
	cell: RuleCell
): ColumnRule | undefined {
	if (!rules || rules.length === 0) return undefined;
	return matchRule(rules, cell.columnId, cell.text) ?? matchRule(rules, cell.columnId, cell.rawValue);
}

/** Colour for one result cell. */
export function cellRuleColor(
	rules: readonly ColumnRule[] | undefined,
	cell: RuleCell
): PaletteColor | undefined {
	return cellRule(rules, cell)?.color;
}

/**
 * Colour for a whole result row: the first `row` rule (in list order) whose own column's cell in
 * this row matches it. A rule that does not opt in with `row` never tints the row.
 */
export function rowRuleColor(
	rules: readonly ColumnRule[] | undefined,
	cells: readonly RuleCell[]
): PaletteColor | undefined {
	for (const rule of rules ?? []) {
		if (!rule.row) continue;
		const cell = cells.find((c) => c.columnId === rule.columnId);
		if (!cell) continue;
		if (matchRule([rule], rule.columnId, cell.text) ?? matchRule([rule], rule.columnId, cell.rawValue)) {
			return rule.color;
		}
	}
	return undefined;
}
