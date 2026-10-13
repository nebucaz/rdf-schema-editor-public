/**
 * What the "Show query" drawer displays (STORY-193): the SPL-style pipeline and the un-paged SPARQL
 * for a model, or — when the model can't run — its validation messages instead. Never throws.
 */
import type { BuilderSchema } from './query-builder-schema';
import { compileUnpagedQuery } from './query-compiler';
import { validateRunnableQueryModel, type QueryModel } from './query-model';
import { printSplPipeline } from './query-spl';

export type QueryOutput =
	| { ok: true; spl: string; sparql: string }
	| { ok: false; messages: string[] };

export function describeQueryOutput(model: QueryModel, schema: BuilderSchema): QueryOutput {
	const issues = validateRunnableQueryModel(model, new Set(schema.classes.keys()));
	if (issues.length > 0) return { ok: false, messages: issues.map((i) => i.message) };
	try {
		return { ok: true, spl: printSplPipeline(model, schema), sparql: compileUnpagedQuery(model, schema) };
	} catch (e) {
		return { ok: false, messages: [e instanceof Error ? e.message : 'The query could not be compiled'] };
	}
}
