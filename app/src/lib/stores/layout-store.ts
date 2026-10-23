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

/**
 * Generic per-key debounced writer (STORY-083) — extracted from `GraphDbLayoutStore`'s own
 * per-element debounce map so any other IRI-keyed writer (e.g. a Note's position writes via
 * `updateNotePosition`) can reuse the identical "one independent debounce timer per key" behavior
 * without depending on `WorkspaceMembership`-specific persistence: a Note is just another
 * `elementIri`-shaped position client as far as this debounce helper is concerned, even though its
 * persistence call is different.
 */
export class KeyedDebouncer<Args extends unknown[]> {
	private writers: Record<string, (...args: Args) => void> = {};

	constructor(private delayMs = 300) {}

	/** Returns the (lazily created, cached) debounced function for `key` — the same instance every
	 *  time `key` repeats, so successive calls for that key keep resetting the same timer instead of
	 *  each spawning an independent one. */
	forKey(key: string, fn: (...args: Args) => void): (...args: Args) => void {
		let existing = this.writers[key];
		if (!existing) {
			existing = debounce(fn, this.delayMs);
			this.writers[key] = existing;
		}
		return existing;
	}
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

/**
 * The subset of `SparqlConnector`'s Workspace-membership methods `GraphDbLayoutStore` needs
 * (STORY-074) — a minimal interface (mirroring `MinimalStorage` above) so tests can inject a plain
 * mock instead of a real connector, and so this module doesn't need to import `sparql-connector.ts`
 * at all.
 */
export interface WorkspaceMemberPositionsSource {
	fetchWorkspaceMembers(workspaceIri: string): Promise<{ elementIri: string; x: number; y: number }[]>;
	updateWorkspaceMemberPosition(workspaceIri: string, elementIri: string, x: number, y: number): Promise<void>;
}

/**
 * GraphDB-backed `LayoutStore` (STORY-074), replacing `LocalStorageLayoutStore` for a Workspace-
 * aware canvas: positions live in `WorkspaceMembership.x`/`.y` (research Decision 2) instead of
 * `localStorage`, so rearranging a diagram on one machine is reflected everywhere that Workspace is
 * opened. `getPosition`/`setPosition` stay synchronous in signature, matching `LayoutStore`, so no
 * canvas call site needs to change — `reload()` must be called (once on initial Workspace load, and
 * again on every active-Workspace change, STORY-076/077's responsibility) before `getPosition`
 * returns anything meaningful.
 */
export class GraphDbLayoutStore implements LayoutStore {
	private cache: Record<string, Position> = {};
	private activeWorkspaceIri: string | null = null;
	private debouncer: KeyedDebouncer<[workspaceIri: string, x: number, y: number]>;

	constructor(
		private connector: WorkspaceMemberPositionsSource,
		private delayMs = 300
	) {
		this.debouncer = new KeyedDebouncer(delayMs);
	}

	getPosition(iri: string): Position | undefined {
		return this.cache[iri];
	}

	/** Updates the in-memory cache immediately (so a `getPosition` right after returns the new
	 *  value) but writes through to GraphDB debounced, keyed per-element so dragging one node
	 *  doesn't delay another's write — mirrors `LocalStorageLayoutStore.setPosition`. A no-op write
	 *  when no Workspace has been loaded yet (`reload` not yet called). */
	setPosition(iri: string, x: number, y: number): void {
		this.cache[iri] = { x, y };
		if (!this.activeWorkspaceIri) return;
		const write = this.debouncer.forKey(iri, (workspaceIri: string, wx: number, wy: number) => {
			void this.connector.updateWorkspaceMemberPosition(workspaceIri, iri, wx, wy);
		});
		write(this.activeWorkspaceIri, x, y);
	}

	/** Re-primes the cache from a fresh `fetchWorkspaceMembers(workspaceIri)` call, replacing the
	 *  previous Workspace's cached positions — called on initial load and on every active-Workspace
	 *  change. */
	async reload(workspaceIri: string): Promise<void> {
		const members = await this.connector.fetchWorkspaceMembers(workspaceIri);
		this.activeWorkspaceIri = workspaceIri;
		this.cache = {};
		for (const member of members) {
			this.cache[member.elementIri] = { x: member.x, y: member.y };
		}
	}

	/** Every element IRI cached for the currently-loaded Workspace (i.e. as of the last `reload()`)
	 *  — reused by the canvas visibility filter (STORY-076) instead of issuing a second
	 *  `fetchWorkspaceMembers` call. */
	getMemberIris(): Set<string> {
		return new Set(Object.keys(this.cache));
	}
}

/** Grid slot for the Nth auto-placed node — same simple layout used for interactively-created nodes. */
export function gridPosition(index: number, columns = 4, cellWidth = 260, cellHeight = 220): Position {
	return { x: (index % columns) * cellWidth, y: Math.floor(index / columns) * cellHeight };
}

/** Estimated flow-space size of a freshly created node — its measured size isn't known until after
 *  first render, so the centering offset uses this (`EntityNode` has `min-width: 200px`). */
export const NEW_NODE_SIZE = { width: 200, height: 80 };
/** Screen-space diagonal step, in px, applied when the viewport center is already occupied. */
export const PLACEMENT_NUDGE_PX = 24;
/** How many nudge steps to try before wrapping back to the exact center. */
export const PLACEMENT_NUDGE_STEPS = 8;

/**
 * Placement for an interactively-created node (`+page.svelte`'s `nextPosition()`): the node's visual
 * center sits on the live viewport center at any pan/zoom. When another node already occupies that
 * spot, nudges diagonally by a fixed on-screen step (so it reads the same at every zoom) up to
 * `PLACEMENT_NUDGE_STEPS` times, then wraps to the center. `occupied` holds existing nodes'
 * top-left flow positions.
 */
export function viewportCenteredPosition(
	viewport: { x: number; y: number; zoom: number },
	canvasWidth: number,
	canvasHeight: number,
	occupied: Position[]
): Position {
	const width = canvasWidth || 800;
	const height = canvasHeight || 600;
	const baseX = (width / 2 - viewport.x) / viewport.zoom - NEW_NODE_SIZE.width / 2;
	const baseY = (height / 2 - viewport.y) / viewport.zoom - NEW_NODE_SIZE.height / 2;
	const step = PLACEMENT_NUDGE_PX / viewport.zoom;
	const isTaken = (x: number, y: number) =>
		occupied.some((p) => Math.abs(p.x - x) < step / 2 && Math.abs(p.y - y) < step / 2);
	for (let k = 0; k < PLACEMENT_NUDGE_STEPS; k++) {
		const x = baseX + k * step;
		const y = baseY + k * step;
		if (!isTaken(x, y)) return { x, y };
	}
	return { x: baseX, y: baseY };
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
