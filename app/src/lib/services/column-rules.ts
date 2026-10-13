/**
 * Column rules (research Q20): value-to-colour rules per result column, stored in the query model's
 * `columnRules`. Pure — shared by the workbench table, the rules editor and the report route so all
 * three render identical colours. Colours are palette *keys*, never CSS strings.
 */

export const PALETTE_COLORS = ['green', 'amber', 'red', 'blue', 'grey'] as const;
export type PaletteColor = (typeof PALETTE_COLORS)[number];

export const RULE_OPS = ['eq', 'contains', 'isEmpty'] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export function isPaletteColor(v: unknown): v is PaletteColor {
	return typeof v === 'string' && (PALETTE_COLORS as readonly string[]).includes(v);
}

export interface ColumnRule {
	columnId: string;
	match: { op: RuleOp; value?: string };
	color: PaletteColor;
	/** Draw the matching cell's text as a saturated chip instead of colouring the whole cell. */
	chip?: boolean;
	/** Also tint the whole result row with this colour when the rule matches its column's cell. */
	row?: boolean;
}

function isBlank(v: string | null | undefined): boolean {
	return v === null || v === undefined || v.trim() === '';
}

function matches(match: ColumnRule['match'], cellValue: string | null | undefined): boolean {
	if (match.op === 'isEmpty') return isBlank(cellValue);
	if (match.value === undefined || cellValue === null || cellValue === undefined) return false;
	const cell = cellValue.toLowerCase();
	const wanted = match.value.toLowerCase();
	if (match.op === 'eq') return cell === wanted;
	return wanted !== '' && cell.includes(wanted);
}

/** First matching rule for the column wins; `undefined` when no rule applies. */
export function matchRule(
	rules: readonly ColumnRule[] | undefined,
	columnId: string,
	cellValue: string | null | undefined
): ColumnRule | undefined {
	for (const rule of rules ?? []) {
		if (rule.columnId === columnId && matches(rule.match, cellValue)) return rule;
	}
	return undefined;
}

/** Colour of the first matching rule for the column; `undefined` when no rule applies. */
export function evaluateRules(
	rules: readonly ColumnRule[] | undefined,
	columnId: string,
	cellValue: string | null | undefined
): PaletteColor | undefined {
	return matchRule(rules, columnId, cellValue)?.color;
}

/** Inline style for a coloured cell; unknown keys (e.g. from a hand-edited model) yield no style. */
export function ruleCellStyle(color: PaletteColor | undefined): string | undefined {
	if (!isPaletteColor(color)) return undefined;
	return `background:var(--rule-${color}-bg);color:var(--rule-${color}-fg)`;
}

/** Inline style for a chip (saturated background); unknown keys yield no style. */
export function chipStyle(color: PaletteColor | undefined): string | undefined {
	if (!isPaletteColor(color)) return undefined;
	return `background:var(--rule-${color}-chip-bg);color:var(--rule-${color}-chip-fg)`;
}
