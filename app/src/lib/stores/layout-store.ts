/**
 * Diagram layout persistence (STORY-010). Per `plan.md`'s ADR default, v1 persists node positions
 * in `localStorage`, keyed by node IRI, mirroring `semantic-crm`'s `stores/settings.ts` pattern —
 * positions aren't semantic RDF, so this stays out of GraphDB entirely. Kept behind the `LayoutStore`
 * interface so a future GraphDB-backed side-channel (for sharing layout across devices) can replace
 * `LocalStorageLayoutStore` without touching canvas code.
 */

export interface Position {
	x: number;
	y: number;
}

export interface LayoutStore {
	getPosition(iri: string): Position | undefined;
	setPosition(iri: string, x: number, y: number): void;
}

/** The subset of the `Storage` interface this store needs — lets tests inject a plain in-memory
 *  fake instead of relying on a real (or globally stubbed) `localStorage`. */
export interface MinimalStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export function debounce<Args extends unknown[]>(
	fn: (...args: Args) => void,
	delayMs: number
): (...args: Args) => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return (...args: Args) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delayMs);
	};
}

const STORAGE_KEY = 'rdf-schema-editor:layout';

export class LocalStorageLayoutStore implements LayoutStore {
	private cache: Record<string, Position> | null = null;
	private persistDebounced: () => void;

	constructor(
		private storage: MinimalStorage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined,
		delayMs = 300
	) {
		this.persistDebounced = debounce(() => this.persist(), delayMs);
	}

	getPosition(iri: string): Position | undefined {
		return this.load()[iri];
	}

	/** Updates the in-memory cache immediately (so a `getPosition` right after returns the new
	 *  value) but writes to storage debounced — not on every animation frame of a drag. */
	setPosition(iri: string, x: number, y: number): void {
		const data = this.load();
		data[iri] = { x, y };
		this.persistDebounced();
	}

	private load(): Record<string, Position> {
		if (this.cache) return this.cache;
		if (!this.storage) {
			this.cache = {};
			return this.cache;
		}
		try {
			const raw = this.storage.getItem(STORAGE_KEY);
			this.cache = raw ? JSON.parse(raw) : {};
		} catch {
			// Corrupted/foreign data under this key — fall back to an empty layout rather than throwing.
			this.cache = {};
		}
		return this.cache!;
	}

	private persist(): void {
		if (!this.storage || !this.cache) return;
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify(this.cache));
		} catch {
			// Storage unavailable/full (e.g. private browsing) — fail silently; positions just won't
			// survive a reload, which is the same graceful degradation as clearing storage entirely.
		}
	}
}

/** Grid slot for the Nth auto-placed node — same simple layout used for interactively-created nodes. */
export function gridPosition(index: number, columns = 4, cellWidth = 260, cellHeight = 220): Position {
	return { x: (index % columns) * cellWidth, y: Math.floor(index / columns) * cellHeight };
}

/**
 * Resolves a position for every node IRI: its stored layout position if one exists, otherwise the
 * next unused auto-layout grid slot — so nodes with no stored position (new since the last save, or
 * loaded for the first time) never stack on top of each other or on top of positioned nodes.
 */
export function resolvePositions(nodeIris: string[], store: LayoutStore): Map<string, Position> {
	const result = new Map<string, Position>();
	let autoIndex = 0;
	for (const iri of nodeIris) {
		const stored = store.getPosition(iri);
		if (stored) {
			result.set(iri, stored);
		} else {
			result.set(iri, gridPosition(autoIndex));
			autoIndex++;
		}
	}
	return result;
}

export const layoutStore: LayoutStore = new LocalStorageLayoutStore();
