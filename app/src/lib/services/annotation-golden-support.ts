/**
 * Test support for `annotation-golden.spec.ts`: runs `SparqlConnector.addAnnotation`/`deleteAnnotation`
 * against a scripted graph and records every operation it issues, so the Go port
 * (`backend/internal/annotations`) can be held to the same sequence via the shared fixture
 * `backend/testdata/golden/annotations.json`.
 */
import { vi } from 'vitest';
import type { AnnotationInput, FactKey } from './sparql-connector';

export type GoldenAnswer = { ask: boolean } | { select: Record<string, { type: string; value: string }>[] };

export interface GoldenOp {
	kind: 'ask' | 'select' | 'update';
	text: string;
}

export interface GoldenInput {
	name: string;
	action: 'add' | 'delete';
	fact?: FactKey;
	annotation?: AnnotationInput;
	annotatedBy?: string;
	annotatedAt?: string;
	annotationIri?: string;
	/** Replies to ASK/SELECT queries, consumed in the order the queries are issued. */
	answers: GoldenAnswer[];
	/** Pins the clock so minted statement/annotation IRIs are reproducible. */
	now: string;
	random: number;
}

export interface GoldenResult {
	ops: GoldenOp[];
	iri?: string;
	error?: string;
}

/** Whitespace is layout in SPARQL, and the TS templates are indented; the Go builders are not. */
export const normalizeSparql = (s: string): string => s.replace(/\s+/g, ' ').trim();

export async function runGolden(input: GoldenInput): Promise<GoldenResult> {
	vi.resetModules();
	vi.useFakeTimers();
	vi.setSystemTime(new Date(input.now));
	vi.spyOn(Math, 'random').mockReturnValue(input.random);
	try {
		const { SparqlConnector } = await import('./sparql-connector');
		const ops: GoldenOp[] = [];
		const answers = [...input.answers];
		const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		const fetchStub = vi.fn(async (url: string, init?: { body?: string }) => {
			const body = JSON.parse(init?.body ?? '{}');
			if (String(url).endsWith('/update')) {
				ops.push({ kind: 'update', text: normalizeSparql(body.update) });
				return json({ success: true });
			}
			const text = normalizeSparql(body.query);
			const answer = answers.shift();
			if (answer === undefined) throw new Error(`unscripted query: ${text}`);
			if ('ask' in answer) {
				ops.push({ kind: 'ask', text });
				return json({ head: {}, boolean: answer.ask });
			}
			ops.push({ kind: 'select', text });
			return json({ head: { vars: [] }, results: { bindings: answer.select } });
		});
		vi.stubGlobal('fetch', fetchStub);
		const connector = new SparqlConnector('/api/sparql');
		try {
			if (input.action === 'delete') {
				await connector.deleteAnnotation(input.annotationIri!);
				return { ops };
			}
			const iri = await connector.addAnnotation(input.fact!, input.annotation!, {
				annotatedBy: input.annotatedBy!,
				annotatedAt: input.annotatedAt!
			});
			return { ops, iri };
		} catch (err) {
			return { ops, error: err instanceof Error ? err.message : String(err) };
		}
	} finally {
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
}
