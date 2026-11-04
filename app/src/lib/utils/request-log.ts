/**
 * Dev-only log of every SPARQL request, grouped by the method that sent it, for finding out where a screen's
 * request count comes from (reduce-requests). `SparqlConnector` records into it only under `import.meta.env.DEV`;
 * in the browser console:
 *
 *   __sparqlRequests.clear()      // before navigating or reloading the screen under test
 *   __sparqlRequests.summary()    // afterwards: a table of callers, request counts and total ms
 *   __sparqlRequests.entries      // the raw list, in the order the requests started
 */

export interface RequestLogEntry {
	seq: number;
	kind: 'query' | 'update';
	/** The connector method (or outer function) that sent the request. */
	caller: string;
	ms: number;
	ok: boolean;
}

export interface RequestSummaryRow {
	caller: string;
	count: number;
	totalMs: number;
	failed: number;
}

/** Frames that only carry a request out; the interesting caller is the first frame beyond them. */
const PLUMBING = new Set(['executeQuery', 'sendUpdate', 'executeUpdate', 'selectQuery', 'askQuery', 'run', 'track']);

/** The first non-plumbing function name in a V8 stack (`at [async] Name.method (file:l:c)`). */
export function callerFromStack(stack: string | undefined): string {
	if (!stack) return '(unknown)';
	for (const line of stack.split('\n').slice(1)) {
		const t = line.trim();
		if (!t.startsWith('at ')) continue;
		const named = /^at (?:async )?(?:new )?([^\s(]+) \(/.exec(t);
		if (!named) return '(anonymous)'; // `at file:line:col` — no function name to report
		const method = named[1].split('.').pop() as string;
		if (PLUMBING.has(method)) continue;
		return method;
	}
	return '(unknown)';
}

export function summarizeRequests(entries: readonly RequestLogEntry[]): RequestSummaryRow[] {
	const byCaller = new Map<string, RequestSummaryRow>();
	for (const e of entries) {
		const row = byCaller.get(e.caller) ?? { caller: e.caller, count: 0, totalMs: 0, failed: 0 };
		row.count++;
		row.totalMs += e.ms;
		if (!e.ok) row.failed++;
		byCaller.set(e.caller, row);
	}
	return [...byCaller.values()].sort((a, b) => b.count - a.count || a.caller.localeCompare(b.caller));
}

export function createRequestLog(cap = 5000) {
	let seq = 0;
	const entries: RequestLogEntry[] = [];
	return {
		entries,
		record(entry: Omit<RequestLogEntry, 'seq'>) {
			entries.push({ ...entry, seq: ++seq });
			if (entries.length > cap) entries.shift();
		},
		clear() {
			entries.length = 0;
		},
		/** Prints the per-caller table to the console and returns it. */
		summary(): RequestSummaryRow[] {
			const rows = summarizeRequests(entries);
			console.table(rows);
			console.info(`${entries.length} SPARQL requests`);
			return rows;
		}
	};
}

export const requestLog = createRequestLog();

if (import.meta.env.DEV && typeof window !== 'undefined') {
	(window as unknown as { __sparqlRequests: typeof requestLog }).__sparqlRequests = requestLog;
}
