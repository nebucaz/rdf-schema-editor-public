import { describe, expect, it, vi } from 'vitest';
import { recordChange } from './change-log-actions';

describe('recordChange (STORY-331)', () => {
	it('posts the entry and reports no problem', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ iri: 'urn:e', changedBy: 'a', changedAt: 't' }), { status: 200 }));
		expect(await recordChange({ kind: 'change', summary: 's' }, fetchFn as never)).toBeNull();
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('turns a failure into a message that says the change itself was saved', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 502 }));
		expect(await recordChange({ kind: 'change', summary: 's' }, fetchFn as never)).toBe('Saved, but the change log entry failed: nope');
	});

	it('leaves out a blank rationale', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify({ iri: 'u', changedBy: 'a', changedAt: 't' }), { status: 200 }));
		await recordChange({ kind: 'change', summary: 's', rationale: '   ' }, fetchFn as never);
		const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(JSON.parse(init.body as string).rationale).toBeUndefined();
	});
});
