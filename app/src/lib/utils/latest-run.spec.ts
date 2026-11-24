import { describe, expect, it } from 'vitest';
import { createLatestRun, relationOptionsKey } from './latest-run.js';

describe('createLatestRun', () => {
	it('only the latest of two overlapping runs may assign its result', () => {
		const run = createLatestRun();
		const first = run.begin('a');
		const second = run.begin('b');
		expect(first?.isCurrent()).toBe(false);
		expect(second?.isCurrent()).toBe(true);
	});

	it('skips a run whose key did not change', () => {
		const run = createLatestRun();
		expect(run.begin('a')).not.toBeNull();
		expect(run.begin('a')).toBeNull();
		expect(run.begin('b')).not.toBeNull();
	});

	it('a skipped run does not invalidate the one in flight', () => {
		const run = createLatestRun();
		const first = run.begin('a');
		run.begin('a');
		expect(first?.isCurrent()).toBe(true);
	});

	it('a failed run is forgotten so the same key can be retried', () => {
		const run = createLatestRun();
		run.begin('a')?.fail();
		expect(run.begin('a')).not.toBeNull();
	});

	it('reset drops the key and invalidates in-flight runs', () => {
		const run = createLatestRun();
		const first = run.begin('a');
		run.reset();
		expect(first?.isCurrent()).toBe(false);
		expect(run.begin('a')).not.toBeNull();
	});
});

describe('relationOptionsKey', () => {
	const f = { iri: 'urn:r', targetClassIri: 'urn:C' };

	it('is stable for the same fields in any order and write count', () => {
		const g = { iri: 'urn:s', targetClassIri: 'urn:D' };
		expect(relationOptionsKey([f, g], 3)).toBe(relationOptionsKey([g, f], 3));
	});

	it('changes when the target class, scheme or write count changes', () => {
		const base = relationOptionsKey([f], 1);
		expect(relationOptionsKey([{ ...f, targetClassIri: 'urn:X' }], 1)).not.toBe(base);
		expect(relationOptionsKey([{ ...f, valueSchemeIri: 'urn:S' }], 1)).not.toBe(base);
		expect(relationOptionsKey([f], 2)).not.toBe(base);
	});
});
