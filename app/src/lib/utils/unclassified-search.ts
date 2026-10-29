/**
 * Rules for searching Unclassified individuals at scale: a single character matches far too much to be a
 * useful (or cheap) search, and the list pages by the last row it showed instead of by offset.
 */

/** A one-character search text is not run; no text at all browses the whole set. */
export function isUnclassifiedQueryTooShort(query: string): boolean {
	return query.trim().length === 1;
}

/** The keyset to continue after, from the last row of the list shown so far. */
export function keysetAfter(rows: { iri: string; label: string }[]): { label: string; iri: string } | undefined {
	const last = rows[rows.length - 1];
	return last ? { label: last.label, iri: last.iri } : undefined;
}
