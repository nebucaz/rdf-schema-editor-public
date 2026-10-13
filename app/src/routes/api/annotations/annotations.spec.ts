import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));
vi.mock('$env/static/private', () => ({ BACKEND_URL: 'http://backend.test', BACKEND_AUTH_TOKEN: 'service-token' }));

const NS = 'https://example.com/annot';
const jwt = (payload: unknown) =>
	`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.RAW-SIGNATURE`;

const fact = {
	subjectIri: `${NS}#app1`,
	predicateIri: `${NS}#lifecycle`,
	object: { kind: 'literal', value: 'Production' }
};

/** An `event.fetch` stand-in: records every SPARQL update and answers queries just enough. */
function mockEventFetch() {
	const updates: string[] = [];
	const fn = vi.fn(async (url: string, init?: { body?: string }) => {
		const body = JSON.parse(init?.body ?? '{}');
		const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
		if (String(url).endsWith('/update')) {
			updates.push(body.update as string);
			return json({ success: true });
		}
		const q: string = body.query;
		if (q.includes('ASK')) return json({ head: {}, boolean: true });
		if (q.includes('GRAPH ?g') && q.includes('a ?type')) {
			return json({ head: { vars: ['g'] }, results: { bindings: [{ g: { type: 'uri', value: NS } }] } });
		}
		return json({ head: { vars: [] }, results: { bindings: [] } });
	});
	return { fn, updates };
}

function req(method: 'POST' | 'DELETE', body: unknown) {
	return new Request('http://localhost/api/annotations', {
		method,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

async function status(p: unknown): Promise<number> {
	try {
		await p;
		return 200;
	} catch (e) {
		return (e as { status?: number }).status ?? 500;
	}
}

describe('/api/annotations', () => {
	beforeEach(() => {
		delete env.USER_AUTH_TOKEN;
		env.USER_AUTH_TOKEN = jwt({ sub: 'alice', name: 'Alice' });
	});
	afterEach(() => vi.resetModules());

	const textBody = { fact, annotation: { type: 'text', text: 'please verify' } };

	it('POST stamps annotatedBy from the token sub and returns the annotation IRI', async () => {
		const { fn, updates } = mockEventFetch();
		const { POST } = await import('./+server');
		const res = await POST({ request: req('POST', textBody), fetch: fn } as never);
		const data = await res.json();
		expect(data.iri).toContain('#Annotation');
		expect(data.annotatedBy).toBe('alice');
		const insert = updates.find((u) => u.includes('please verify'))!;
		expect(insert).toContain('annotatedBy> "alice"');
	});

	it('ignores a client-supplied annotatedBy/annotatedAt', async () => {
		const { fn, updates } = mockEventFetch();
		const { POST } = await import('./+server');
		const forged = {
			...textBody,
			annotatedBy: 'mallory',
			annotatedAt: '1999-01-01T00:00:00.000Z',
			annotation: { ...textBody.annotation, annotatedBy: 'mallory', annotatedAt: '1999-01-01T00:00:00.000Z' }
		};
		const res = await POST({ request: req('POST', forged), fetch: fn } as never);
		const insert = updates.find((u) => u.includes('please verify'))!;
		expect(insert).toContain('annotatedBy> "alice"');
		expect(insert).not.toContain('mallory');
		expect(insert).not.toContain('1999-01-01');
		expect((await res.json()).annotatedBy).toBe('alice');
	});

	it.each([
		['no token', undefined],
		['garbage token', 'not-a-jwt'],
		['expired token', jwt({ sub: 'alice', exp: 1 })]
	])('POST returns 401 and writes nothing with %s', async (_n, token) => {
		env.USER_AUTH_TOKEN = token;
		const { fn, updates } = mockEventFetch();
		const { POST } = await import('./+server');
		expect(await status(POST({ request: req('POST', textBody), fetch: fn } as never))).toBe(401);
		expect(updates).toEqual([]);
		expect(fn).not.toHaveBeenCalled();
	});

	it.each([
		['non-JSON body', '{nope'],
		['missing fact', { annotation: { type: 'text', text: 'x' } }],
		['missing annotation', { fact }],
		['unknown annotation type', { fact, annotation: { type: 'sticker', text: 'x' } }],
		['empty text', { fact, annotation: { type: 'text', text: '   ' } }],
		['over-long text', { fact, annotation: { type: 'text', text: 'x'.repeat(2001) } }],
		['unsafe subject IRI', { fact: { ...fact, subjectIri: 'urn:a>b' }, annotation: textBody.annotation }],
		['unsafe predicate IRI', { fact: { ...fact, predicateIri: 'urn:a b' }, annotation: textBody.annotation }],
		['unsafe object IRI', { fact: { ...fact, object: { kind: 'iri', iri: 'urn:x}' } }, annotation: textBody.annotation }],
		['unsafe datatype', { fact: { ...fact, object: { kind: 'literal', value: 'x', datatype: 'urn:d>' } }, annotation: textBody.annotation }],
		['label without IRI', { fact, annotation: { type: 'label' } }],
		['unsafe label IRI', { fact, annotation: { type: 'label', labelIri: 'urn:l>' } }]
	])('POST returns 400 and writes nothing for %s', async (_n, body) => {
		const { fn, updates } = mockEventFetch();
		const { POST } = await import('./+server');
		expect(await status(POST({ request: req('POST', body), fetch: fn } as never))).toBe(400);
		expect(updates).toEqual([]);
	});

	it('DELETE removes an annotation by IRI, scoped to Annotation-typed nodes', async () => {
		const { fn, updates } = mockEventFetch();
		const { DELETE } = await import('./+server');
		const res = await DELETE({ request: req('DELETE', { iri: `${NS}#Annotation1` }), fetch: fn } as never);
		expect((await res.json()).success).toBe(true);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${NS}#Annotation1> a <`);
		expect(updates[0]).toContain('Annotation>');
		expect(updates[0]).not.toContain('rdf:Statement');
	});

	it('DELETE validates the IRI and requires a user', async () => {
		const { fn, updates } = mockEventFetch();
		const { DELETE } = await import('./+server');
		expect(await status(DELETE({ request: req('DELETE', { iri: 'urn:a>b' }), fetch: fn } as never))).toBe(400);
		expect(await status(DELETE({ request: req('DELETE', {}), fetch: fn } as never))).toBe(400);
		env.USER_AUTH_TOKEN = undefined;
		expect(await status(DELETE({ request: req('DELETE', { iri: `${NS}#A` }), fetch: fn } as never))).toBe(401);
		expect(updates).toEqual([]);
	});

	it('never exposes the raw tokens in a response', async () => {
		const { fn } = mockEventFetch();
		const { POST } = await import('./+server');
		const res = await POST({ request: req('POST', textBody), fetch: fn } as never);
		const text = JSON.stringify(await res.json());
		expect(text).not.toContain('RAW-SIGNATURE');
		expect(text).not.toContain('service-token');
		expect(text).not.toContain(env.USER_AUTH_TOKEN as string);
	});
});
