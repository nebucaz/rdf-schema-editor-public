import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SPARQL_ENDPOINT_URL, SPARQL_USER, SPARQL_PASSWORD } from '$env/static/private';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const query = body?.query;

	if (!query || typeof query !== 'string') {
		throw error(400, 'Missing or invalid "query" parameter');
	}

	// GraphDB-specific SPARQL protocol extension: `infer=false` restricts the query to asserted
	// statements, bypassing the repository's reasoner (see `fetchWholeGraphQuads`).
	const infer = body?.infer;

	const headers: HeadersInit = {
		'Content-Type': 'application/x-www-form-urlencoded',
		Accept: 'application/sparql-results+json'
	};

	if (SPARQL_USER && SPARQL_PASSWORD) {
		const credentials = Buffer.from(`${SPARQL_USER}:${SPARQL_PASSWORD}`).toString('base64');
		headers['Authorization'] = `Basic ${credentials}`;
	}

	const params = new URLSearchParams({ query });
	if (infer === false) params.set('infer', 'false');

	let response: Response;
	try {
		response = await fetch(SPARQL_ENDPOINT_URL, {
			method: 'POST',
			headers,
			body: params.toString()
		});
	} catch (err) {
		throw error(502, `GraphDB unreachable: ${err instanceof Error ? err.message : 'Unknown error'}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw error(502, `SPARQL query failed: ${errorText}`);
	}

	const data = await response.json();
	return json(data);
};
