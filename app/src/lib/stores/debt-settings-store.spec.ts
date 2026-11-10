import { describe, expect, it } from 'vitest';
import { LocalStorageDebtSettingsStore } from './debt-settings-store';

function memory(initial: Record<string, string> = {}) {
	const data = { ...initial };
	return {
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => { data[k] = v; },
		data
	};
}

describe('LocalStorageDebtSettingsStore (STORY-334)', () => {
	it('returns the defaults when nothing is stored', () => {
		expect(new LocalStorageDebtSettingsStore(memory()).get()).toEqual({ reviewPeriodMonths: 3, staleAfterMonths: 12 });
	});

	it('saves and reads back', () => {
		const storage = memory();
		new LocalStorageDebtSettingsStore(storage).set({ reviewPeriodMonths: 6, staleAfterMonths: 18 });
		expect(new LocalStorageDebtSettingsStore(storage).get()).toEqual({ reviewPeriodMonths: 6, staleAfterMonths: 18 });
	});

	it('ignores a broken stored value and a missing storage', () => {
		expect(new LocalStorageDebtSettingsStore(memory({ 'rdf-schema-editor:debt-settings': '{' })).get().reviewPeriodMonths).toBe(3);
		expect(new LocalStorageDebtSettingsStore(undefined).get().staleAfterMonths).toBe(12);
	});
});
