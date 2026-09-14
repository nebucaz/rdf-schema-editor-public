import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BACKEND_URL, BACKEND_AUTH_TOKEN } from '$env/static/private';

/**
 * Thin proxy for the Go backend's `GET /validation/report` (STORY-130) — no validation-specific
 * logic here, matching `api/sources/backstage/discover/+server.ts`'s existing proxy-route
 * convention. Consumed by STORY-132's `/validation` report view.
 */
export const GET: RequestHandler = async () => {
	let response: Response;
	try {
		response = await fetch(`${BACKEND_URL}/validation/report`, {
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
		throw error(response.status, `Validation report failed: ${errorText}`);
	}

	const data = await response.json();
	return json(data);
};
