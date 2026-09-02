import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BACKEND_URL } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const update = body?.update;

	if (!update || typeof update !== 'string') {
		throw error(400, 'Missing or invalid "update" parameter');
	}

	// The Go backend (`backend/`) is the sole thing that talks to GraphDB directly and holds its
	// credentials — this route just forwards the same form-encoded contract GraphDB itself expects.
	let response: Response;
	try {
		response = await fetch(`${BACKEND_URL}/sparql/update`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json'
			},
			body: new URLSearchParams({ update }).toString()
		});
	} catch (err) {
		throw error(502, `Backend unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw error(502, `SPARQL update failed: ${errorText}`);
	}

	return json({ success: true });
};
