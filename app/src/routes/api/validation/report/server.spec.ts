import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/private', () => ({
	BACKEND_URL: 'http://backend.test',
	BACKEND_AUTH_TOKEN: 'test-token'
}));

describe('GET /api/validation/report', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('forwards to the backend with the configured bearer token', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

		const { GET } = await import('./+server');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET({} as any);

		expect(fetchMock).toHaveBeenCalledWith(
			'http://backend.test/validation/report',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
			})
		);
	});

	it('relays a successful violation list unchanged', async () => {
		const violations = [
			{
				individualIri: 'http://example.org#Alice',
				individualLabel: 'Alice',
				typeIri: 'http://example.org#Person',
				path: 'http://example.org#age',
				constraint: 'minCount',
				message: 'missing required value'
			}
		];
		fetchMock.mockResolvedValue(new Response(JSON.stringify(violations), { status: 200 }));

		const { GET } = await import('./+server');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const response = (await GET({} as any)) as Response;

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(violations);
	});

	it('relays a backend failure as an error with the same status', async () => {
		fetchMock.mockResolvedValue(new Response('graphdb unreachable', { status: 502 }));

		const { GET } = await import('./+server');

		await expect(GET({} as never)).rejects.toMatchObject({ status: 502 });
	});
});
