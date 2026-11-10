import { describe, expect, it } from 'vitest';
import { DEFAULT_DEBT_SETTINGS, monthsAgo, parseDebtSettings } from './debt-settings';

describe('debt settings (STORY-334)', () => {
	it('defaults to a quarterly question review and a year of staleness', () => {
		expect(DEFAULT_DEBT_SETTINGS).toEqual({ reviewPeriodMonths: 3, staleAfterMonths: 12 });
	});

	it('reads stored settings and falls back per field', () => {
		expect(parseDebtSettings('{"reviewPeriodMonths":6,"staleAfterMonths":24}')).toEqual({ reviewPeriodMonths: 6, staleAfterMonths: 24 });
		expect(parseDebtSettings('{"reviewPeriodMonths":0,"staleAfterMonths":"x"}')).toEqual(DEFAULT_DEBT_SETTINGS);
		expect(parseDebtSettings('not json')).toEqual(DEFAULT_DEBT_SETTINGS);
		expect(parseDebtSettings(null)).toEqual(DEFAULT_DEBT_SETTINGS);
		expect(parseDebtSettings('{"reviewPeriodMonths":2.5}').reviewPeriodMonths).toBe(3);
	});
});

describe('monthsAgo', () => {
	const now = new Date('2026-11-10T12:00:00Z');
	it('counts whole calendar months since a date', () => {
		expect(monthsAgo('2026-08-10', now)).toBe(3);
		expect(monthsAgo('2026-08-11', now)).toBe(2);
		expect(monthsAgo('2025-11-10', now)).toBe(12);
	});

	it('is null for an empty or unreadable date', () => {
		expect(monthsAgo('', now)).toBeNull();
		expect(monthsAgo('soon', now)).toBeNull();
	});
});
