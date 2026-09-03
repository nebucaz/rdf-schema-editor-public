import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BACKEND_URL, BACKEND_AUTH_TOKEN } from '$env/static/private';

/**
 * Thin proxy for the Go backend's `GET /sources/backstage/discover` (Story 004) — no business logic
 * here, matching `api/sparql/+server.ts`'s existing proxy-route convention. Consumed by Story 006's
 * "Missing concepts" panel.
 */
export const GET: RequestHandler = async () => {
	let response: Response;
	try {
		response = await fetch(`${BACKEND_URL}/sources/backstage/discover`, {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${BACKEND_AUTH_TOKEN}`
			}
		});
	} catch (err) {
		throw error(502, `Backend unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw error(response.status, `Discovery failed: ${errorText}`);
	}

	const data = await response.json();
	return json(data);
};
