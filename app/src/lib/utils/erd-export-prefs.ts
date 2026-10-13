import type { MinimalStorage } from '$lib/stores/layout-store';
import type { Notation } from '$lib/services/erd-layout';

/** Remembered Export ERD dialog choices (STORY-159). A per-viewer convenience only — every storage
 *  access is wrapped, so a blocked/absent `localStorage` just means the defaults apply. */

export type ErdExportFormat = 'svg' | 'png';

export interface ErdExportPrefs {
	notation: Notation;
	legend: boolean;
	format: ErdExportFormat;
}

export const NOTATIONS: readonly Notation[] = ['crows-foot', 'chen', 'uml'];
export const DEFAULT_ERD_EXPORT_PREFS: ErdExportPrefs = { notation: 'crows-foot', legend: true, format: 'svg' };

const STORAGE_KEY = 'rdf-schema-editor:erd-export-prefs';

function defaultStorage(): MinimalStorage | undefined {
	try {
		return typeof window !== 'undefined' ? window.localStorage : undefined;
	} catch {
		return undefined;
	}
}

export function readErdExportPrefs(storage: MinimalStorage | undefined = defaultStorage()): ErdExportPrefs {
	try {
		const raw = storage?.getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_ERD_EXPORT_PREFS };
		const parsed = JSON.parse(raw) as Partial<Record<keyof ErdExportPrefs, unknown>>;
		return {
			notation: NOTATIONS.includes(parsed.notation as Notation) ? (parsed.notation as Notation) : DEFAULT_ERD_EXPORT_PREFS.notation,
			legend: typeof parsed.legend === 'boolean' ? parsed.legend : DEFAULT_ERD_EXPORT_PREFS.legend,
			format: parsed.format === 'png' || parsed.format === 'svg' ? parsed.format : DEFAULT_ERD_EXPORT_PREFS.format
		};
	} catch {
		return { ...DEFAULT_ERD_EXPORT_PREFS };
	}
}

export function writeErdExportPrefs(prefs: ErdExportPrefs, storage: MinimalStorage | undefined = defaultStorage()): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		// storage unavailable — the choice simply isn't remembered
	}
}
