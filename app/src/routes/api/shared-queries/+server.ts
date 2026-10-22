import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { readUserIdentity } from '$lib/server/user-identity';
import { SparqlConnector } from '$lib/services/sparql-connector';
import { parseQueryModel, serializeQueryModel } from '$lib/services/query-model';
import { MAX_SHARED_MODEL_BYTES, newShortId } from '$lib/services/short-links';

/**
 * Creates a short share link (object-browser STORY-261). Any workbench user may create one; the
 * server validates the model strictly and stamps `createdBy` (user token `sub`, when present) and
 * `createdAt` itself, ignoring client values. Same trust level as the rest of the app: a caller posting
 * straight to `/api/sparql/update` can still write anything.
 */
const MAX_ID_ATTEMPTS = 5;

export const POST: RequestHandler = async ({ request, fetch }) => {
	const raw = await request.text();
	if (raw.length > MAX_SHARED_MODEL_BYTES) throw error(413, 'The query is too large to share');
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		throw error(400, 'Request body must be a JSON object');
	}
	const model = (body as { model?: unknown } | null)?.model;
	if (typeof body !== 'object' || body === null || typeof model !== 'object' || model === null) {
		throw error(400, 'Missing "model"');
	}
	const parsed = parseQueryModel(JSON.stringify(model));
	if (!parsed.ok) throw error(400, parsed.error);

	const createdBy = readUserIdentity(env.USER_AUTH_TOKEN)?.sub;
	const modelJson = serializeQueryModel(parsed.model);
	const connector = new SparqlConnector('/api/sparql', fetch);
	try {
		for (let i = 0; i < MAX_ID_ATTEMPTS; i++) {
			const id = newShortId();
			if (await connector.insertSharedQuery(id, modelJson, createdBy, new Date().toISOString())) {
				return json({ id });
			}
		}
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : 'The link could not be created');
	}
	throw error(503, 'Could not allocate a free link id, try again');
};
