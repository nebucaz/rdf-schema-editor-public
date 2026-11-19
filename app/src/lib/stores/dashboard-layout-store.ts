/** Loads and saves the Ontology dashboard layout (spec/ontology-dashboard STORY-469), behind an interface like
 *  `layout-store.ts` so another backing can replace the endpoint. A failed load is not an error (the default layout
 *  is used); a failed save keeps the arrangement in memory, which is the caller's state, and reports a notice. */
import { parseDashboardLayout, resetLayout, type DashboardLayout } from '#lib/services/dashboard-layout.js';
import { apiUrl } from '#lib/utils/urls.js';

export interface DashboardLayoutStore {
	load(): Promise<DashboardLayout>;
	/** Debounced: only the latest layout of a burst is written. */
	save(layout: DashboardLayout): void;
}

const PREFERENCE_PATH = '/preferences/ontology-dashboard';
const SAVE_DEBOUNCE_MS = 600;

interface Options {
	fetchFn?: typeof fetch;
	debounceMs?: number;
	/** Called with a message after a failed save and with `null` after the next successful one. */
	onSaveError?: (message: string | null) => void;
}

export class ApiDashboardLayoutStore implements DashboardLayoutStore {
	private readonly fetchFn: typeof fetch;
	private readonly debounceMs: number;
	private readonly onSaveError: (message: string | null) => void;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor({ fetchFn, debounceMs = SAVE_DEBOUNCE_MS, onSaveError = () => {} }: Options = {}) {
		this.fetchFn = fetchFn ?? ((...args) => fetch(...args));
		this.debounceMs = debounceMs;
		this.onSaveError = onSaveError;
	}

	async load(): Promise<DashboardLayout> {
		try {
			const response = await this.fetchFn(apiUrl(PREFERENCE_PATH));
			if (!response.ok) return resetLayout();
			const body = (await response.json()) as { value?: unknown };
			return body.value == null ? resetLayout() : parseDashboardLayout(body.value);
		} catch {
			return resetLayout();
		}
	}

	save(layout: DashboardLayout): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.write(layout), this.debounceMs);
	}

	private async write(layout: DashboardLayout): Promise<void> {
		try {
			const response = await this.fetchFn(apiUrl(PREFERENCE_PATH), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: layout })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(body?.message ?? `The server answered ${response.status}`);
			}
			this.onSaveError(null);
		} catch (e) {
			this.onSaveError(`Your arrangement could not be saved: ${e instanceof Error ? e.message : String(e)}. It stays in this session.`);
		}
	}
}
