/**
 * CSV export of a workbench query (STORY-194): runs the compiled query in `MAX_PAGE_SIZE` chunks
 * (never one unbounded query) up to `EXPORT_ROW_CAP` rows and returns plain string rows for `toCsv`.
 * No backend, no extra dependency — the same `selectQuery` the table uses.
 */
import type { BuilderSchema } from './query-builder-schema';
import { MAX_PAGE_SIZE, compileQuery } from './query-compiler';
import { EXPORT_ROW_CAP, type QueryModel } from './query-model';
import { buildResultRows, type ResultCell } from './query-results';
import type { SparqlSelectResults } from './sparql-connector';

/** Hard cap on exported rows; a larger result is truncated and the user is told. */
export { EXPORT_ROW_CAP };

export interface ExportResult {
	headers: string[];
	rows: string[][];
	/** More rows existed than `EXPORT_ROW_CAP`. */
	truncated: boolean;
}

/** Literals export their raw value; entities their label (or full IRI with `rawIris`). */
export function exportCellText(cell: ResultCell, rawIris: boolean): string {
	if (cell.title !== undefined) return rawIris ? cell.title : cell.text;
	return cell.rawValue;
}

export async function exportAllRows(
	model: QueryModel,
	schema: BuilderSchema,
	executor: { selectQuery(query: string): Promise<SparqlSelectResults> },
	options: { rawIris?: boolean; onProgress?: (rowsSoFar: number) => void; now?: Date } = {}
): Promise<ExportResult> {
	const rawIris = options.rawIris === true;
	// One reading for every chunk, so a relative window cannot shift between pages of one export.
	const now = options.now ?? new Date();
	let headers: string[] = [];
	const rows: string[][] = [];
	let truncated = false;

	for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
		const compiled = compileQuery(model, schema, { limit: MAX_PAGE_SIZE, offset }, { now });
		const page = buildResultRows(model, compiled, await executor.selectQuery(compiled.sparql));
		if (offset === 0) headers = page.headers;
		for (const r of page.rows) rows.push(r.map((c) => exportCellText(c, rawIris)));
		options.onProgress?.(Math.min(rows.length, EXPORT_ROW_CAP));

		const fullPage = page.rows.length === MAX_PAGE_SIZE;
		// A model-level row limit is the user's own cap (not a truncation): stop as soon as it is met.
		if (model.limit !== undefined && rows.length >= model.limit) break;
		if (rows.length >= EXPORT_ROW_CAP) {
			if (rows.length > EXPORT_ROW_CAP) {
				rows.length = EXPORT_ROW_CAP;
				truncated = true;
			} else if (fullPage) {
				// Exactly at the cap: probe one row beyond it to know whether anything was cut off.
				const probe = compileQuery(model, schema, { limit: 1, offset: EXPORT_ROW_CAP }, { now });
				const more = await executor.selectQuery(probe.sparql);
				truncated = more.results.bindings.length > 0;
			}
			break;
		}
		if (!fullPage) break;
	}
	return { headers, rows, truncated };
}

/** `<saved-query-name>.csv` (sanitised), or `workbench-export-<yyyy-mm-dd>.csv`. */
export function exportFileName(savedQueryName: string | null, now: Date = new Date()): string {
	const slug = (savedQueryName ?? '')
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug ? `${slug}.csv` : `workbench-export-${now.toISOString().slice(0, 10)}.csv`;
}
