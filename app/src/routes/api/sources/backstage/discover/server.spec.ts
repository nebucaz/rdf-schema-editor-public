import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/private', () => ({
	BACKEND_URL: 'http://backend.test',
	BACKEND_AUTH_TOKEN: 'test-token'
}));

describe('GET /api/sources/backstage/discover', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it('attaches the configured bearer token to the backend request', async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ source: 'backstage', unmappedKinds: [] }), { status: 200 })
		);

		const { GET } = await import('./+server');

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await GET({} as any);

		expect(fetchMock).toHaveBeenCalledWith(
			'http://backend.test/sources/backstage/discover',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
			})
		);
	});
});
