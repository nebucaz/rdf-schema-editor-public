import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RDF, RDFS, type Quad } from './turtle';
import { loadSocQuads, SOC_DATA_NS, SOC_SCHEMA_NS } from './soc-test-support';
import { RUNBOOK_QUERIES, RUNBOOK_VARIANTS } from './soc-runbook-queries';
import { buildBuilderSchema } from './query-builder-schema';
import { compileUnpagedQuery } from './query-compiler';
import { parseSpl } from './query-spl-parser';
import { printSplPipeline } from './query-spl';
import { buildSocFetchedSchema, SOC_BASE_IRI } from './soc-test-support';

/**
 * `examples/soc/RUNBOOK.md` (STORY-209): quotes the SPL blocks of `soc-runbook-queries.ts` verbatim and every
 * number it promises is recomputed here from the dataset, so the walkthrough cannot drift from the data.
 */

const runbook = readFileSync(
	fileURLToPath(new URL('../../../../examples/soc/RUNBOOK.md', import.meta.url)),
	'utf8'
);
const quads = loadSocQuads();
const P = (n: string) => SCHEMA(n);
function SCHEMA(n: string) {
	return SOC_SCHEMA_NS + n;
}
const all = (s: string, p: string) =>
	quads.filter((q: Quad) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value);
const one = (s: string, p: string) => all(s, p)[0];
const ofClass = (c: string) => [
	...new Set(quads.filter((q) => q.predicate.value === RDF.type && q.object.value === P(c)).map((q) => q.subject.value))
];
const local = (iri: string) => iri.slice(SOC_DATA_NS.length);
const events = ofClass('AuthenticationEvent');
const alerts = ofClass('Alert');
const alertByCode = (c: string) => alerts.find((a) => one(a, P('alertId')) === c)!;
const hostOfEvent = (e: string) => one(one(e, P('recordedIn')), P('hostedOn'));
const label = (iri: string) => one(iri, RDFS.label);

describe('RUNBOOK.md structure', () => {
	it('has the seven numbered steps in order', () => {
		const headings = [...runbook.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => [Number(m[1]), m[2]] as const);
		expect(headings.map((h) => h[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
		const titles = headings.map((h) => h[1].toLowerCase()).join('|');
		for (const word of ['load', 'pivot', 'alert', 'aggregate', 'blast', 'triage', 'reset']) {
			expect(titles, word).toContain(word);
		}
	});

	it('states the import order schema → shapes → data', () => {
		const a = runbook.indexOf('soc-schema.ttl');
		const b = runbook.indexOf('soc-shapes.ttl');
		const c = runbook.indexOf('soc-data.ttl');
		expect(a).toBeGreaterThan(-1);
		expect(b).toBeGreaterThan(a);
		expect(c).toBeGreaterThan(b);
	});

	it('has a Limits section naming only inverse traversal, OR and relative time', () => {
		const limits = runbook.slice(runbook.search(/^## What the engine can't do yet/m));
		expect(limits.length).toBeGreaterThan(0);
		for (const gap of ['inverse', 'OR', 'relative']) expect(limits, gap).toContain(gap);
		for (const gone of ['No SPL input', 'No measure filter', 'No date ranges']) expect(limits, gone).not.toContain(gone);
		expect(limits).toContain('spec/query-workbench/plan.md');
	});

	it('leads steps 3–5 with a paste-able SPL block and keeps the click path in an appendix', () => {
		for (const n of [3, 4, 5]) {
			const start = runbook.search(new RegExp(`^## ${n}\\. `, 'm'));
			const body = runbook.slice(start, runbook.indexOf('\n## ', start + 1));
			expect(body, `step ${n}`).toContain('```\n');
			expect(body, `step ${n} has no click path`).not.toMatch(/Pick the class|Pick \*\*/);
		}
		expect(runbook).toMatch(/^## Appendix: the click path$/m);
	});
});

describe('RUNBOOK.md SPL blocks', () => {
	it.each(['R3', 'R4', 'R5'] as const)('quotes the %s snapshot verbatim in a fenced block', (id) => {
		expect(runbook).toContain('```\n' + RUNBOOK_QUERIES[id].spl + '\n```');
	});
});

describe('RUNBOOK.md SPL fences parse to the tested models', () => {
	const builder = buildBuilderSchema(buildSocFetchedSchema(quads));
	const fences = [...runbook.matchAll(/^```\n([\s\S]*?)\n```$/gm)].map((m) => m[1]);
	const expected = [...Object.values(RUNBOOK_QUERIES), ...Object.values(RUNBOOK_VARIANTS)];

	it('has a fence for every runbook query and variant', () => {
		for (const q of expected) expect(fences, q.title).toContain(q.spl);
	});

	it.each(fences.map((f, i) => [i, f] as const))('fence %i parses and equals its model', (_i, spl) => {
		const q = expected.find((e) => e.spl === spl);
		expect(q, `no tested model for fence:\n${spl}`).toBeDefined();
		const parsed = parseSpl(spl, builder, { namespaces: [SOC_BASE_IRI] });
		if (!parsed.ok) throw new Error(`${parsed.error.message} @${parsed.error.start}`);
		// Sugar (`top`) is one-way: the printer emits the canonical form of the same model.
		expect(printSplPipeline(parsed.model, builder)).toBe(printSplPipeline(q!.model, builder));
		expect(compileUnpagedQuery(parsed.model, builder)).toBe(compileUnpagedQuery(q!.model, builder));
	});
});

describe('RUNBOOK.md expected results match the data', () => {
	it('R3: High alerts trace to web-01 auth.log (13 rows) and dc-01 Security.evtx (1 row)', () => {
		const highRows = alerts
			.filter((a) => local(one(a, P('severity'))) === 'severityHigh')
			.flatMap((a) => all(a, P('triggeredBy')).map((e) => ({ a, e })));
		expect(highRows).toHaveLength(14);
		expect(runbook).toContain('14 rows');
		for (const code of ['A-1001', 'A-1004']) expect(runbook).toContain(code);
		const byHost = (code: string) => new Set(all(alertByCode(code), P('triggeredBy')).map((e) => local(hostOfEvent(e))));
		expect([...byHost('A-1001')]).toEqual(['web-01']);
		expect([...byHost('A-1004')]).toEqual(['dc-01']);
		expect([...byHost('A-1002')].sort()).toEqual(['app-01', 'web-01', 'web-02']);
		expect([...byHost('A-1003')]).toEqual(['db-01']);
		expect(runbook).toContain('Security.evtx');
	});

	it('R4: failures by sourceIp are 13 / 8 / 7 / 1', () => {
		const counts = new Map<string, number>();
		for (const e of events) {
			if (local(one(e, P('outcome'))) !== 'outcomeFailure') continue;
			counts.set(one(e, P('sourceIp')), (counts.get(one(e, P('sourceIp'))) ?? 0) + 1);
		}
		const ranked = [...counts].sort((a, b) => b[1] - a[1]);
		expect(ranked).toEqual([
			['203.0.113.45', 13],
			['198.51.100.7', 8],
			['192.0.2.10', 7],
			['192.0.2.88', 1]
		]);
		for (const [ip, n] of ranked) expect(runbook).toMatch(new RegExp(`${ip.replace(/\./g, '\\.')}[^\\n]*\\b${n}\\b`));
	});

	it('R5: 203.0.113.45 reaches web-01 (13 events, 13 users) and bastion-01 (1 event, 1 user)', () => {
		const byHost = new Map<string, { events: number; users: Set<string> }>();
		for (const e of events.filter((x) => one(x, P('sourceIp')) === '203.0.113.45')) {
			const h = label(hostOfEvent(e));
			const r = byHost.get(h) ?? { events: 0, users: new Set<string>() };
			r.events++;
			r.users.add(one(e, P('user')));
			byHost.set(h, r);
		}
		expect([...byHost].map(([h, r]) => [h, r.events, r.users.size])).toEqual([
			['web-01', 13, 13],
			['bastion-01', 1, 1]
		]);
		expect(runbook).toMatch(/web-01[^\n]*\b13\b[^\n]*\b13\b/);
		expect(runbook).toMatch(/bastion-01[^\n]*\b1\b[^\n]*\b1\b/);
	});

	it('step 2: the search finds 14 events', () => {
		const hits = events.filter((e) =>
			quads.some((q) => q.subject.value === e && q.object.termType === 'Literal' && q.object.value.includes('203.0.113.45'))
		);
		expect(hits).toHaveLength(14);
		expect(runbook).toMatch(/14 (events|hits|matches)/);
	});
});
