import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/static/private', () => ({
	BACKEND_URL: 'http://backend.test',
	BACKEND_AUTH_TOKEN: 'test-token'
}));

describe('POST /api/sparql/update', () => {
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
		fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

		const { POST } = await import('./+server');
		const request = new Request('http://localhost/api/sparql/update', {
			method: 'POST',
			body: JSON.stringify({ update: 'INSERT DATA { <urn:s> <urn:p> <urn:o> }' })
		});

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await POST({ request } as any);

		expect(fetchMock).toHaveBeenCalledWith(
			'http://backend.test/sparql/update',
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
			})
		);
	});
});
