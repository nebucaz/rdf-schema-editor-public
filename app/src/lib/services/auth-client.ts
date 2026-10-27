export type AuthResult = { ok: true } | { ok: false; message: string };

async function post(path: string, fetchFn: typeof fetch): Promise<AuthResult> {
	try {
		// JSON content type: the backend's CSRF guard rejects anything else from a browser.
		const response = await fetchFn(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}'
		});
		if (response.ok) return { ok: true };
		const body = (await response.json().catch(() => null)) as { message?: string } | null;
		return { ok: false, message: body?.message ?? `${path} returned ${response.status}` };
	} catch (e) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/** `POST /api/auth/dev-login` — the backend sets the HttpOnly `Oglala` cookie; nothing is stored here. */
export const devLogin = (fetchFn: typeof fetch = fetch) => post('/api/auth/dev-login', fetchFn);

/** `POST /api/auth/logout` — the backend clears the cookie. */
export const devLogout = (fetchFn: typeof fetch = fetch) => post('/api/auth/logout', fetchFn);
