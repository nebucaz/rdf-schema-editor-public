import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SPARQL_ENDPOINT_URL, SPARQL_USER, SPARQL_PASSWORD } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const update = body?.update;

	if (!update || typeof update !== 'string') {
		throw error(400, 'Missing or invalid "update" parameter');
	}

	// GraphDB uses the /statements endpoint for SPARQL Update requests.
	const updateUrl = `${SPARQL_ENDPOINT_URL}/statements`;

	const headers: HeadersInit = {
		'Content-Type': 'application/sparql-update',
		Accept: 'application/json'
	};

	if (SPARQL_USER && SPARQL_PASSWORD) {
		const credentials = Buffer.from(`${SPARQL_USER}:${SPARQL_PASSWORD}`).toString('base64');
		headers['Authorization'] = `Basic ${credentials}`;
	}

	let response: Response;
	try {
		response = await fetch(updateUrl, {
			method: 'POST',
			headers,
			body: update
		});
	} catch (err) {
		throw error(502, `GraphDB unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw error(502, `SPARQL update failed: ${errorText}`);
	}

	return json({ success: true });
};
