import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SparqlConnector } from '$lib/services/sparql-connector';
import { parseQueryModel } from '$lib/services/query-model';
import { isShortId } from '$lib/services/short-links';

/** Resolves a short share link to its model. A malformed id is rejected before any SPARQL runs. */
export const GET: RequestHandler = async ({ params, fetch }) => {
	if (!isShortId(params.id)) throw error(404, 'The shared query was not found.');
	const connector = new SparqlConnector('/api/sparql', fetch);
	let modelJson: string | null;
	try {
		modelJson = await connector.fetchSharedQuery(params.id);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : 'The shared query could not be read');
	}
	if (modelJson === null) throw error(404, 'The shared query was not found.');
	const parsed = parseQueryModel(modelJson);
	if (!parsed.ok) throw error(404, 'The shared query is damaged and could not be read.');
	return json({ model: parsed.model });
};
