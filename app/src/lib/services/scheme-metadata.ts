/**
 * Dublin Core description of a concept scheme (skos-support STORY-408). Pure; storage is in `SparqlConnector`.
 * Governance (steward, authority, maturity) stays on the namespace node and is not repeated here.
 */
import { isSafeSparqlIri } from '#lib/utils/sparql-safe.js';

export interface SchemeMetadata {
	title: string;
	/** An IRI or plain text. */
	creator: string;
	/** An IRI or plain text. */
	publisher: string;
	rights: string;
	/** Set by the app on every scheme or member-concept write, UTC ISO; never typed. */
	modified: string;
}

export const emptySchemeMetadata = (): SchemeMetadata => ({ title: '', creator: '', publisher: '', rights: '', modified: '' });

/** `dct:modified` value: UTC, whole seconds, from an injectable clock. */
export function utcTimestamp(now: Date = new Date()): string {
	return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** An absolute `scheme://` or `urn:` value is meant as an IRI, anything else is text. `null` when empty. */
export function classifyAgent(raw: string): { kind: 'iri' | 'literal'; value: string } | null {
	const value = raw.trim();
	if (!value) return null;
	return /^([a-zA-Z][a-zA-Z\d+.-]*:\/\/|urn:)/.test(value) ? { kind: 'iri', value } : { kind: 'literal', value };
}

export function validateSchemeMetadata(m: SchemeMetadata): string[] {
	const errors: string[] = [];
	for (const [label, raw] of [['Creator', m.creator], ['Publisher', m.publisher]] as const) {
		const agent = classifyAgent(raw);
		if (agent?.kind === 'iri' && !isSafeSparqlIri(agent.value)) errors.push(`${label} must be a well-formed IRI or plain text`);
	}
	return errors;
}
