import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { BACKEND_URL } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const query = body?.query;

	if (!query || typeof query !== 'string') {
		throw error(400, 'Missing or invalid "query" parameter');
	}

	// GraphDB-specific SPARQL protocol extension: `infer=false` restricts the query to asserted
	// statements, bypassing the repository's reasoner (see `fetchWholeGraphQuads`).
	const infer = body?.infer;

	const params = new URLSearchParams({ query });
	if (infer === false) params.set('infer', 'false');

	// The Go backend (`backend/`) is the sole thing that talks to GraphDB directly and holds its
	// credentials — this route just forwards the same form-encoded contract GraphDB itself expects.
	let response: Response;
	try {
		response = await fetch(`${BACKEND_URL}/sparql`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/sparql-results+json'
			},
			body: params.toString()
		});
	} catch (err) {
		throw error(502, `Backend unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw error(502, `SPARQL query failed: ${errorText}`);
	}

	const data = await response.json();
	return json(data);
};
