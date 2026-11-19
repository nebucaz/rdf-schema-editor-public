/**
 * Scheme ids (skos-support STORY-427): the `?scheme=` value of `/review/scheme`, built like the report ids of
 * `report-id.ts`: the local name for a scheme in the core vocabulary namespace, else `~` + base64url(IRI). The id is
 * only ever compared with the IRIs of fetched schemes; it is never interpolated into a query.
 */
import { fromBase64Url, toBase64Url } from '../utils/base64url';

const LOCAL_NAME = /^[A-Za-z0-9_-]+$/;
const ENCODED = /^~[A-Za-z0-9_-]+$/;

export function schemeIdForIri(iri: string, coreBaseIri: string): string {
	const prefix = `${coreBaseIri}#`;
	if (iri.startsWith(prefix) && LOCAL_NAME.test(iri.slice(prefix.length))) return iri.slice(prefix.length);
	return `~${toBase64Url(iri)}`;
}

/** `null` for anything that is not a well-formed scheme id. */
export function iriForSchemeId(id: string, coreBaseIri: string): string | null {
	if (LOCAL_NAME.test(id)) return `${coreBaseIri}#${id}`;
	if (!ENCODED.test(id)) return null;
	const iri = fromBase64Url(id.slice(1));
	return iri && /^https?:\/\/[^\s<>"{}|\\^`]+$/.test(iri) ? iri : null;
}

/** The scheme an id names among the fetched ones, or `null` when the id is malformed or names none of them. */
export function resolveScheme<T extends { iri: string }>(schemes: readonly T[], id: string, coreBaseIri: string): T | null {
	const iri = iriForSchemeId(id, coreBaseIri);
	return iri === null ? null : (schemes.find((s) => s.iri === iri) ?? null);
}
