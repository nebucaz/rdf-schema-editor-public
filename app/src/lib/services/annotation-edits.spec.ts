import { describe, it, expect } from 'vitest';
import {
	withAnnotation,
	withoutAnnotation,
	withReplacedAnnotation,
	pendingAnnotation,
	isPendingAnnotation,
	runOptimistic,
	annotateDisabledReason
} from './annotation-edits';
import type { FetchedAnnotation } from './sparql-connector';

const a = (iri: string, over: Partial<FetchedAnnotation> = {}): FetchedAnnotation => ({
	iri, type: 'text', text: iri, annotatedBy: 'u-1', annotatedAt: '2026-03-01T10:00:00Z', ...over
});

describe('annotation map edits (immutable)', () => {
	it('withAnnotation appends for a fact and leaves the original map untouched', () => {
		const before = new Map([['k', [a('x')]]]);
		const after = withAnnotation(before, 'k', a('y'));
		expect(after.get('k')?.map((v) => v.iri)).toEqual(['x', 'y']);
		expect(before.get('k')).toHaveLength(1);
		expect(withAnnotation(new Map(), 'k', a('y')).get('k')).toHaveLength(1);
	});

	it('withAnnotation can re-insert at a position (delete rollback)', () => {
		const m = new Map([['k', [a('x'), a('z')]]]);
		expect(withAnnotation(m, 'k', a('y'), 1).get('k')?.map((v) => v.iri)).toEqual(['x', 'y', 'z']);
	});

	it('withoutAnnotation removes by iri and is a no-op when absent', () => {
		const m = new Map([['k', [a('x'), a('y')]]]);
		expect(withoutAnnotation(m, 'k', 'x').get('k')?.map((v) => v.iri)).toEqual(['y']);
		expect(withoutAnnotation(m, 'k', 'nope').get('k')).toHaveLength(2);
		expect(withoutAnnotation(m, 'other', 'x')).toBe(m);
	});

	it('withReplacedAnnotation swaps a pending entry for the server-confirmed one in place', () => {
		const m = new Map([['k', [a('x'), a('pending:1'), a('z')]]]);
		const next = withReplacedAnnotation(m, 'k', 'pending:1', a('real', { annotatedBy: 'server-sub' }));
		expect(next.get('k')?.map((v) => v.iri)).toEqual(['x', 'real', 'z']);
		expect(next.get('k')?.[1].annotatedBy).toBe('server-sub');
	});
});

describe('pendingAnnotation', () => {
	it('builds a text annotation attributed to the current user, flagged as pending', () => {
		const p = pendingAnnotation({ type: 'text', text: 'look' }, { sub: 'u-1', displayName: 'A' }, undefined, 1);
		expect(p).toMatchObject({ type: 'text', text: 'look', annotatedBy: 'u-1' });
		expect(isPendingAnnotation(p)).toBe(true);
		expect(isPendingAnnotation(a('http://x/real'))).toBe(false);
	});

	it('resolves a label annotation\'s display text from the known labels', () => {
		const p = pendingAnnotation(
			{ type: 'label', labelIri: 'http://x#Verified' },
			{ sub: 'u-1', displayName: 'A' },
			[{ iri: 'http://x#Verified', label: 'Verified' }],
			2
		);
		expect(p).toMatchObject({ type: 'label', labelIri: 'http://x#Verified', labelText: 'Verified' });
	});

	it('gives each pending entry a distinct iri', () => {
		const u = { sub: 'u', displayName: 'U' };
		expect(pendingAnnotation({ type: 'text', text: 't' }, u, undefined, 1).iri)
			.not.toBe(pendingAnnotation({ type: 'text', text: 't' }, u, undefined, 2).iri);
	});
});

describe('runOptimistic', () => {
	it('applies immediately, then commits the request result', async () => {
		const log: string[] = [];
		const result = await runOptimistic({
			apply: () => log.push('apply'),
			request: async () => { log.push('request'); return 'saved'; },
			commit: (r) => log.push(`commit:${r}`),
			rollback: () => log.push('rollback')
		});
		expect(result).toBe('saved');
		expect(log).toEqual(['apply', 'request', 'commit:saved']);
	});

	it('rolls back and rethrows when the request fails', async () => {
		const log: string[] = [];
		await expect(
			runOptimistic({
				apply: () => log.push('apply'),
				request: async () => { throw new Error('401'); },
				commit: () => log.push('commit'),
				rollback: () => log.push('rollback')
			})
		).rejects.toThrow('401');
		expect(log).toEqual(['apply', 'rollback']);
	});
});

describe('annotateDisabledReason', () => {
	it('explains the read-only panel when there is no identity, and is null when signed in', () => {
		expect(annotateDisabledReason(null)).toMatch(/user identity/i);
		expect(annotateDisabledReason(undefined)).toMatch(/user identity/i);
		expect(annotateDisabledReason({ sub: 'u-1', displayName: 'A' })).toBeNull();
	});
});
