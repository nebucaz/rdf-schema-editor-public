/**
 * Server-only user identity, read from a JWT (query-workbench STORY-179, research Q2).
 *
 * The token is **decoded, not verified**: the SvelteKit server has no signing secret, and the token
 * stands in for one issued by an IdP elsewhere. Once a real IdP exists, verify the signature here
 * (public key / JWKS) before trusting any claim. The raw token and the claims other than `sub` and
 * `name` must never reach the browser.
 */

export interface UserIdentity {
	sub: string;
	displayName: string;
}

/** Tokens/payloads beyond this are treated as malformed rather than decoded. */
const MAX_TOKEN_LENGTH = 8192;

function decodeBase64UrlJson(segment: string): unknown {
	if (!/^[A-Za-z0-9_-]*$/.test(segment)) return undefined;
	try {
		const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
	} catch {
		return undefined;
	}
}

/**
 * `{ sub, displayName }` — `displayName` is the `name` claim when it is a non-blank string, else
 * `sub` — or `null` for a missing, malformed or expired token. `nowMs` is injectable for tests.
 */
export function readUserIdentity(
	token: string | undefined | null,
	nowMs: number = Date.now()
): UserIdentity | null {
	if (typeof token !== 'string') return null;
	const trimmed = token.trim();
	if (!trimmed || trimmed.length > MAX_TOKEN_LENGTH) return null;

	const segments = trimmed.split('.');
	if (segments.length !== 3) return null;

	const payload = decodeBase64UrlJson(segments[1]);
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
	const claims = payload as Record<string, unknown>;

	if (typeof claims.sub !== 'string' || claims.sub.length === 0) return null;
	if (claims.exp !== undefined) {
		if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
		if (claims.exp * 1000 <= nowMs) return null;
	}

	const name = typeof claims.name === 'string' ? claims.name.trim() : '';
	return { sub: claims.sub, displayName: name || claims.sub };
}
