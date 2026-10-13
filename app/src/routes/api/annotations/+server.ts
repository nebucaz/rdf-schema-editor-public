import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { readUserIdentity } from '$lib/server/user-identity';
import {
	SparqlConnector,
	ANNOTATION_MAX_TEXT_LENGTH,
	type AnnotationInput,
	type FactKey,
	type FactObject
} from '$lib/services/sparql-connector';
import { isSafeSparqlIri } from '$lib/utils/sparql-safe';

/**
 * Annotation writes (query-workbench STORY-183, research Q2 option A). The server — not the
 * browser — stamps `annotatedBy` (the user token's `sub`) and `annotatedAt`; any such fields in the
 * request body are ignored. The connector runs in-process through `event.fetch`, i.e. the same
 * browser → SvelteKit → backend proxy path (`/api/sparql*`, `BACKEND_AUTH_TOKEN`) as every other write.
 *
 * Accepted limitation: a caller who posts directly to the generic `/api/sparql/update` proxy can
 * still write any author. This route gives correct attribution for the normal UI, at the same trust
 * level as the rest of the app; backend-side stamping is the upgrade path.
 */

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function safeIri(v: unknown, what: string): string {
	if (typeof v !== 'string' || v.length === 0 || !isSafeSparqlIri(v)) {
		throw error(400, `Invalid ${what}`);
	}
	return v;
}

function parseFact(raw: unknown): FactKey {
	if (!isObj(raw)) throw error(400, 'Missing or invalid "fact"');
	const subjectIri = safeIri(raw.subjectIri, 'subject IRI');
	const predicateIri = safeIri(raw.predicateIri, 'predicate IRI');
	const o = raw.object;
	if (!isObj(o)) throw error(400, 'Missing or invalid "fact.object"');
	let object: FactObject;
	if (o.kind === 'iri') {
		object = { kind: 'iri', iri: safeIri(o.iri, 'object IRI') };
	} else if (o.kind === 'literal') {
		if (typeof o.value !== 'string') throw error(400, 'Invalid literal value');
		object = { kind: 'literal', value: o.value };
		if (o.datatype !== undefined) object.datatype = safeIri(o.datatype, 'datatype IRI');
		if (o.lang !== undefined) {
			if (typeof o.lang !== 'string' || !/^[A-Za-z]+(-[A-Za-z0-9]+)*$/.test(o.lang)) {
				throw error(400, 'Invalid language tag');
			}
			object.lang = o.lang;
		}
		if (object.datatype !== undefined && object.lang !== undefined) {
			throw error(400, 'A literal cannot have both a datatype and a language tag');
		}
	} else {
		throw error(400, 'fact.object.kind must be "iri" or "literal"');
	}
	return { subjectIri, predicateIri, object };
}

function parseAnnotation(raw: unknown): AnnotationInput {
	if (!isObj(raw)) throw error(400, 'Missing or invalid "annotation"');
	if (raw.type === 'text') {
		if (typeof raw.text !== 'string' || raw.text.trim().length === 0) {
			throw error(400, 'Annotation text must not be empty');
		}
		if (raw.text.trim().length > ANNOTATION_MAX_TEXT_LENGTH) {
			throw error(400, `Annotation text must be at most ${ANNOTATION_MAX_TEXT_LENGTH} characters`);
		}
		return { type: 'text', text: raw.text };
	}
	if (raw.type === 'label') {
		return { type: 'label', labelIri: safeIri(raw.labelIri, 'label IRI') };
	}
	throw error(400, 'annotation.type must be "text" or "label"');
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	if (!isObj(body)) throw error(400, 'Request body must be a JSON object');
	return body;
}

function requireUser() {
	const user = readUserIdentity(env.USER_AUTH_TOKEN);
	if (!user) throw error(401, 'Annotating requires a signed-in user');
	return user;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const user = requireUser();
	const body = await readBody(request);
	const fact = parseFact(body.fact);
	const annotation = parseAnnotation(body.annotation);

	// Client-supplied author/timestamp are deliberately never read.
	const annotatedBy = user.sub;
	const annotatedAt = new Date().toISOString();

	const connector = new SparqlConnector('/api/sparql', fetch);
	let iri: string;
	try {
		iri = await connector.addAnnotation(fact, annotation, { annotatedBy, annotatedAt });
	} catch (err) {
		throw error(400, err instanceof Error ? err.message : 'Annotation could not be saved');
	}
	return json({ iri, annotatedBy, annotatedAt });
};

export const DELETE: RequestHandler = async ({ request, fetch }) => {
	requireUser();
	const body = await readBody(request);
	const iri = safeIri(body.iri, 'annotation IRI');
	// `deleteAnnotation` only matches nodes typed Annotation, so nothing else is removable here.
	const connector = new SparqlConnector('/api/sparql', fetch);
	try {
		await connector.deleteAnnotation(iri);
	} catch (err) {
		throw error(502, err instanceof Error ? err.message : 'Annotation could not be removed');
	}
	return json({ success: true });
};
