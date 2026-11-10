/**
 * The semantic debt settings (ontology-pipeline STORY-334). Like the other view preferences they are per
 * browser, in `localStorage` behind an injectable storage.
 */
import { DEFAULT_DEBT_SETTINGS, parseDebtSettings, type DebtSettings } from '#lib/services/debt-settings.js';
import type { MinimalStorage } from './layout-store';

const STORAGE_KEY = 'rdf-schema-editor:debt-settings';

export class LocalStorageDebtSettingsStore {
	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	get(): DebtSettings {
		try {
			return parseDebtSettings(this.storage?.getItem(STORAGE_KEY) ?? null);
		} catch {
			return { ...DEFAULT_DEBT_SETTINGS };
		}
	}

	set(settings: DebtSettings): void {
		try {
			this.storage?.setItem(STORAGE_KEY, JSON.stringify(parseDebtSettings(JSON.stringify(settings))));
		} catch {
			// Storage unavailable or full: the settings just do not survive a reload.
		}
	}
}

export const debtSettingsStore = new LocalStorageDebtSettingsStore();
