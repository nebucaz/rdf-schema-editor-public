/**
 * Per-browser tint for a workbench column group (workbench-columns STORY-248). Purely a view
 * preference — like `node-color-store` it lives in `localStorage`, never in the `QueryModel`, SPL or
 * a saved query. A group is identified by its hop id plus its class (`groupKey`), so the same class
 * reached twice keeps two colours and a different query's group never inherits one by accident.
 *
 * Only palette colours are accepted: the value ends up in an inline style, and the palette is the
 * set whose header-text contrast is verified in both themes.
 */

import type { MinimalStorage } from './layout-store';
import { NOTE_PASTEL_COLORS, NOTE_PASTEL_COLORS_DARK } from '$lib/utils/color-palette';

/** Light value (the one that is stored) and its muted dark-theme counterpart. */
export const GROUP_TINTS = NOTE_PASTEL_COLORS.map((light, i) => ({
	light,
	dark: NOTE_PASTEL_COLORS_DARK[i]
}));

export function groupKey(hopId: string | null, classIri: string): string {
	return `${hopId ?? 'root'}|${classIri}`;
}

/** The colour to paint for a stored (light) tint in the current theme; `undefined` = default group background. */
export function tintFor(stored: string | undefined, dark: boolean): string | undefined {
	const tint = GROUP_TINTS.find((t) => t.light === stored);
	return tint ? (dark ? tint.dark : tint.light) : undefined;
}

export interface GroupColorStore {
	getColor(key: string): string | undefined;
	setColor(key: string, color: string | undefined): void;
}

const STORAGE_KEY = 'rdf-schema-editor:workbench-group-colors';
const isPaletteColor = (v: unknown): v is string => GROUP_TINTS.some((t) => t.light === v);

export class LocalStorageGroupColorStore implements GroupColorStore {
	private cache: Record<string, string> | null = null;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined
	) {}

	getColor(key: string): string | undefined {
		return this.load()[key];
	}

	/** `undefined` clears the override; a colour outside the palette is ignored. */
	setColor(key: string, color: string | undefined): void {
		const data = this.load();
		if (color === undefined) delete data[key];
		else if (isPaletteColor(color)) data[key] = color;
		else return;
		this.persist();
	}

	private load(): Record<string, string> {
		if (this.cache) return this.cache;
		const out: Record<string, string> = {};
		try {
			const raw = this.storage?.getItem(STORAGE_KEY);
			const parsed: unknown = raw ? JSON.parse(raw) : {};
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				for (const [k, v] of Object.entries(parsed)) if (isPaletteColor(v)) out[k] = v;
			}
		} catch {
			// Unavailable or corrupted storage: start with no overrides rather than throwing.
		}
		this.cache = out;
		return out;
	}

	private persist(): void {
		if (!this.storage || !this.cache) return;
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch {
			// Storage full/unavailable: colours just won't survive a reload.
		}
	}
}

export const workbenchGroupColorStore: GroupColorStore = new LocalStorageGroupColorStore();
