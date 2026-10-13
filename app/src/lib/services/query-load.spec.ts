import { describe, it, expect } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { emptyQueryModel } from './query-model';
import { prepareModelLoad, prepareSplLoad } from './query-load';
import { SPL_MODE_KEY, readSplMode, writeSplMode } from './spl-mode-preference';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI } from './soc-test-support';
import { RUNBOOK_QUERIES } from './soc-runbook-queries';

const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const scope = [SOC_BASE_IRI];

describe('prepareModelLoad', () => {
	it('accepts a runnable model', () => {
		const model = RUNBOOK_QUERIES.R3.model;
		const r = prepareModelLoad(model, schema);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.model).toBe(model);
	});

	it('rejects a model whose root class is unknown, joining the issues', () => {
		const r = prepareModelLoad(emptyQueryModel('http://example.org/Nope', scope), schema);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/cannot run/i);
	});
});

describe('prepareSplLoad', () => {
	it('parses a runbook query to the same model the printer came from', () => {
		const r3 = RUNBOOK_QUERIES.R3;
		const r = prepareSplLoad(r3.spl, schema, scope);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.model.hops.length).toBe(r3.model.hops.length);
	});

	it('returns the positioned parse error for bad SPL', () => {
		const r = prepareSplLoad('Alert | frobnicate', schema, scope);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.start).toBeGreaterThanOrEqual(0);
			expect(r.error.message.length).toBeGreaterThan(0);
		}
	});

	it('turns an exception inside the parser into a generic error, never throwing', () => {
		const r = prepareSplLoad('Alert', null as never, scope);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.message).toMatch(/could not parse/i);
	});

	it('rejects empty input with a message', () => {
		const r = prepareSplLoad('   ', schema, scope);
		expect(r.ok).toBe(false);
	});
});

describe('spl mode preference', () => {
	const mem = () => {
		const m = new Map<string, string>();
		return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
	};
	it('defaults to search and round-trips spl', () => {
		const s = mem();
		expect(readSplMode(s)).toBe('search');
		writeSplMode(s, 'spl');
		expect(s.getItem(SPL_MODE_KEY)).toBe('spl');
		expect(readSplMode(s)).toBe('spl');
	});
	it('ignores unknown stored values', () => {
		const s = mem();
		s.setItem(SPL_MODE_KEY, 'bogus');
		expect(readSplMode(s)).toBe('search');
	});
	it('degrades to search when storage throws or is missing', () => {
		const boom = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			}
		};
		expect(readSplMode(boom)).toBe('search');
		expect(() => writeSplMode(boom, 'spl')).not.toThrow();
		expect(readSplMode(undefined)).toBe('search');
	});
});
