/**
 * Determines which SPARQL query form a user typed, skipping any leading `PREFIX`/`BASE`
 * declarations, whitespace, and `#`-comments, so the Query Console (STORY-085) can dispatch to
 * `selectQuery`/`askQuery` without a full SPARQL parser (research §4 — no such dependency exists
 * in `package.json`, and a keyword-anywhere-in-the-text heuristic would false-positive inside
 * string literals/comments). `CONSTRUCT`/`DESCRIBE` and anything else is `'unsupported'`.
 */

const LEADING_WHITESPACE_OR_COMMENT = /^(\s+|#[^\n]*\n?)+/;
const LEADING_PREFIX_DECL = /^PREFIX\s+[^\s:]*:\s*<[^>]*>\s*/i;
const LEADING_BASE_DECL = /^BASE\s*<[^>]*>\s*/i;

export type SparqlQueryForm = 'select' | 'ask' | 'unsupported';

export function detectQueryForm(query: string): SparqlQueryForm {
	let rest = query;
	for (;;) {
		const wsMatch = rest.match(LEADING_WHITESPACE_OR_COMMENT);
		if (wsMatch) {
			rest = rest.slice(wsMatch[0].length);
			continue;
		}
		const prefixMatch = rest.match(LEADING_PREFIX_DECL);
		if (prefixMatch) {
			rest = rest.slice(prefixMatch[0].length);
			continue;
		}
		const baseMatch = rest.match(LEADING_BASE_DECL);
		if (baseMatch) {
			rest = rest.slice(baseMatch[0].length);
			continue;
		}
		break;
	}
	if (/^select\b/i.test(rest)) return 'select';
	if (/^ask\b/i.test(rest)) return 'ask';
	return 'unsupported';
}
