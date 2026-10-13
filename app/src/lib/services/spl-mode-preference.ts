/**
 * Per-viewer Search | SPL toggle (spl-input STORY-220). A convenience only: any storage failure
 * (blocked, private window, missing) degrades to free-text search and never throws.
 */
export type SplMode = 'search' | 'spl';

export const SPL_MODE_KEY = 'workbench-search-mode';

export interface ModeStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function readSplMode(storage: ModeStorage | undefined): SplMode {
	try {
		return storage?.getItem(SPL_MODE_KEY) === 'spl' ? 'spl' : 'search';
	} catch {
		return 'search';
	}
}

export function writeSplMode(storage: ModeStorage | undefined, mode: SplMode): void {
	try {
		storage?.setItem(SPL_MODE_KEY, mode);
	} catch {
		/* preference is best-effort */
	}
}
