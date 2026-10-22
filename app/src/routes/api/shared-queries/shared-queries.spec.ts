import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$env/static/private', () => ({ BACKEND_URL: 'http://backend.test', BACKEND_AUTH_TOKEN: 'service-token' }));

import { startQueryFromClass } from '$lib/services/query-model-edit';
import { serializeQueryModel } from '$lib/services/query-model';

const NS = 'https://example.com/o';
const jwt = (payload: unknown) =>
	`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.SIG`;
const model = startQueryFromClass(`${NS}#A`, [NS]);

/** In-memory SharedQuery store behind an `event.fetch` stand-in. */
function mockStore(takenIds: string[] = []) {
	const stored = new Map<string, string>();
	const taken = new Set(takenIds);
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (url: string, init?: { body?: string }) => {
		const body = JSON.parse(init?.body ?? '{}');
		const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		if (String(url).endsWith('/update')) {
			const u: string = body.update;
			updates.push(u);
			const m = /<[^>]*#SharedQuery([A-Za-z0-9]{10})> a /.exec(u);
			const lit = /queryModelJson> "((?:[^"\\]|\\.)*)"/.exec(u);
			if (m && lit) stored.set(m[1], JSON.parse(`"${lit[1]}"`));
			return json({ success: true });
		}
		const q: string = body.query;
		queries.push(q);
		if (q.includes('ASK')) {
			const m = /#SharedQuery([A-Za-z0-9]{10})> \?p \?o/.exec(q);
			if (m) return json({ head: {}, boolean: stored.has(m[1]) || taken.has(m[1]) });
			return json({ head: {}, boolean: true }); // class already declared
		}
		const m = /#SharedQuery([A-Za-z0-9]{10})> a/.exec(q);
		const found = m ? stored.get(m[1]) : undefined;
		return json({
			head: { vars: ['model'] },
			results: { bindings: found === undefined ? [] : [{ model: { type: 'literal', value: found } }] }
		});
	});
	return { fn, stored, updates, queries };
}

const post = (body: unknown) =>
	new Request('http://localhost/api/shared-queries', {
		method: 'POST',
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

async function status(p: unknown): Promise<number> {
	try {
		await p;
		return 200;
	} catch (e) {
		return (e as { status?: number }).status ?? 500;
	}
}

describe('/api/shared-queries', () => {
	beforeEach(() => {
		delete env.USER_AUTH_TOKEN;
	});
	afterEach(() => vi.resetModules());

	it('creates a link, stamps createdAt and ignores client-supplied createdBy/createdAt', async () => {
		env.USER_AUTH_TOKEN = jwt({ sub: 'alice' });
		const { POST } = await import('./+server');
		const store = mockStore();
		const res = await POST({
			request: post({ model, createdBy: 'mallory', createdAt: '1998-01-01T00:00:00Z' }),
			fetch: store.fn
		} as never);
		const { id } = await res.json();
		expect(id).toMatch(/^[A-Za-z0-9]{10}$/);
		const update = store.updates.at(-1)!;
		expect(update).toContain('"alice"');
		expect(update).not.toContain('mallory');
		expect(update).not.toContain('1998');
		expect(store.stored.get(id)).toBe(serializeQueryModel(model));
	});

	it('works without a signed-in user and then writes no createdBy', async () => {
		const { POST } = await import('./+server');
		const store = mockStore();
		const res = await POST({ request: post({ model }), fetch: store.fn } as never);
		expect((await res.json()).id).toMatch(/^[A-Za-z0-9]{10}$/);
		expect(store.updates.at(-1)).not.toContain('createdBy');
	});

	it('rejects a missing, invalid or non-JSON body without writing', async () => {
		const { POST } = await import('./+server');
		const store = mockStore();
		for (const body of ['not json', {}, { model: 'x' }, { model: { version: 1 } }, { model: { ...model, version: 2 } }]) {
			expect(await status(POST({ request: post(body), fetch: store.fn } as never))).toBe(400);
		}
		expect(store.updates).toHaveLength(0);
	});

	it('rejects an oversized body', async () => {
		const { POST } = await import('./+server');
		const store = mockStore();
		const big = JSON.stringify({ model, pad: 'x'.repeat(250_000) });
		expect(await status(POST({ request: post(big), fetch: store.fn } as never))).toBe(413);
		expect(store.updates).toHaveLength(0);
	});

	it('retries on an id collision', async () => {
		const shortLinks = await import('$lib/services/short-links');
		const ids = ['takenAAAAA', 'freeBBBBBB'];
		const spy = vi.spyOn(shortLinks, 'newShortId').mockImplementation(() => ids.shift()!);
		const { POST } = await import('./+server');
		const store = mockStore(['takenAAAAA']);
		const res = await POST({ request: post({ model }), fetch: store.fn } as never);
		expect((await res.json()).id).toBe('freeBBBBBB');
		expect(store.stored.has('takenAAAAA')).toBe(false);
		spy.mockRestore();
	});

	it('GET resolves a created link and 404s an unknown id', async () => {
		const { POST } = await import('./+server');
		const { GET } = await import('./[id]/+server');
		const store = mockStore();
		const { id } = await (await POST({ request: post({ model }), fetch: store.fn } as never)).json();
		const res = await GET({ params: { id }, fetch: store.fn } as never);
		expect((await res.json()).model).toEqual(model);
		expect(await status(GET({ params: { id: 'zzzzzzzzzz' }, fetch: store.fn } as never))).toBe(404);
	});

	it('GET rejects a malformed id without running any query', async () => {
		const { GET } = await import('./[id]/+server');
		const store = mockStore();
		for (const id of ['short', 'aaaaaaaaaa> } DROP', 'aaaaaaaaaa1', '']) {
			expect(await status(GET({ params: { id }, fetch: store.fn } as never))).toBe(404);
		}
		expect(store.fn).not.toHaveBeenCalled();
	});

	it('round-trips the 6-level / 10-column fixture that overflows ?m=', async () => {
		const { deepModel } = await import('$lib/services/query-share-deep.fixture');
		const big = deepModel(10);
		const { POST } = await import('./+server');
		const { GET } = await import('./[id]/+server');
		const store = mockStore();
		const { id } = await (await POST({ request: post({ model: big }), fetch: store.fn } as never)).json();
		const res = await GET({ params: { id }, fetch: store.fn } as never);
		expect((await res.json()).model).toEqual(big);
	});
});
