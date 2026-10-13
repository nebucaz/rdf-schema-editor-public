import { describe, it, expect, vi, beforeEach } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const jwt = (payload: unknown) =>
	`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.SECRET-SIGNATURE`;

describe('root layout load', () => {
	beforeEach(() => {
		delete env.USER_AUTH_TOKEN;
	});

	it('returns only sub and displayName — never the token or other claims', async () => {
		env.USER_AUTH_TOKEN = jwt({ sub: 'alice', name: 'Alice', email: 'a@example.org', role: 'admin' });
		const { load } = await import('./+layout.server');
		const data = (await load({} as never)) as { user: unknown };
		expect(data).toEqual({ user: { sub: 'alice', displayName: 'Alice' } });
		const text = JSON.stringify(data);
		expect(text).not.toContain('SECRET-SIGNATURE');
		expect(text).not.toContain('a@example.org');
		expect(text).not.toContain('admin');
	});

	it('returns user: null when the token is absent', async () => {
		const { load } = await import('./+layout.server');
		expect(await load({} as never)).toEqual({ user: null });
	});
});
