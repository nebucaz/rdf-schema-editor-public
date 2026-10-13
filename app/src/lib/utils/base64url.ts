/** UTF-8 safe base64url (RFC 4648 §5, no padding) — used for URL-embedded ids and models. */
export function toBase64Url(text: string): string {
	let binary = '';
	for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `null` for anything that is not valid base64url of valid UTF-8. */
export function fromBase64Url(encoded: string): string | null {
	if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null;
	try {
		const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
		const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
