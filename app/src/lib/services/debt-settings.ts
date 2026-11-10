/**
 * Settings of the semantic debt list (ontology-pipeline STORY-334): how often competency questions are
 * reviewed (quarterly, book p. 240) and after how many months an untouched concept counts as stale.
 */
export interface DebtSettings {
	reviewPeriodMonths: number;
	staleAfterMonths: number;
}

export const DEFAULT_DEBT_SETTINGS: DebtSettings = { reviewPeriodMonths: 3, staleAfterMonths: 12 };

const MAX_MONTHS = 120;
const valid = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_MONTHS;

/** Stored settings, with the default for every field that is missing or not a whole number of months. */
export function parseDebtSettings(text: string | null): DebtSettings {
	let raw: Partial<Record<keyof DebtSettings, unknown>> = {};
	try {
		const parsed: unknown = text ? JSON.parse(text) : {};
		if (parsed && typeof parsed === 'object') raw = parsed as typeof raw;
	} catch {
		/* a broken value means the defaults */
	}
	return {
		reviewPeriodMonths: valid(raw.reviewPeriodMonths) ? raw.reviewPeriodMonths : DEFAULT_DEBT_SETTINGS.reviewPeriodMonths,
		staleAfterMonths: valid(raw.staleAfterMonths) ? raw.staleAfterMonths : DEFAULT_DEBT_SETTINGS.staleAfterMonths
	};
}

/** Whole calendar months from `date` (`YYYY-MM-DD`) to `now`; null when the date is empty or unreadable. */
export function monthsAgo(date: string, now: Date): number | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
	if (!m) return null;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - mo) - (now.getUTCDate() < d ? 1 : 0);
	return Math.max(0, months);
}
