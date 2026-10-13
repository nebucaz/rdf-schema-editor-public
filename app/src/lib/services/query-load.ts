/**
 * The one door for external query input into the builder (spl-input STORY-220). Shared links
 * (`?m=`/`?query=`), opened saved queries and typed SPL all reach `queryBuilderStore.load` through
 * these helpers, so "is this runnable?" is decided in one place. Pure: no store, no DOM.
 */
import type { BuilderSchema } from './query-builder-schema';
import { validateRunnableQueryModel, type QueryModel } from './query-model';
import { parseSpl, type SplParseError } from './query-spl-parser';

export type ModelLoad = { ok: true; model: QueryModel } | { ok: false; message: string };
export type SplLoad = { ok: true; model: QueryModel } | { ok: false; error: SplParseError };

/** Accepts `model` only if it can run against `schema`; otherwise says why, in one line. */
export function prepareModelLoad(model: QueryModel, schema: BuilderSchema): ModelLoad {
	const issues = validateRunnableQueryModel(model, new Set(schema.classes.keys()), schema);
	if (issues.length > 0) {
		return { ok: false, message: `The query cannot run: ${issues.map((i) => i.message).join('; ')}` };
	}
	return { ok: true, model };
}

/**
 * Parses SPL against the schema and the workbench namespace selection. `parseSpl` already validates
 * runnability; this wrapper adds the empty-input case and guarantees nothing throws.
 */
export function prepareSplLoad(text: string, schema: BuilderSchema, namespaces: string[]): SplLoad {
	if (text.trim() === '') {
		return { ok: false, error: { message: 'Enter an SPL query to run', start: 0, end: 0 } };
	}
	try {
		return parseSpl(text, schema, { namespaces });
	} catch {
		return { ok: false, error: { message: 'Could not parse the query', start: 0, end: text.length } };
	}
}
