/**
 * Minimal, dependency-free Turtle syntax highlighter for the raw-triples editor
 * (`TriplesPanel.svelte`). Tokenizes with a hand-rolled scanner (matching the rest of the
 * codebase's "no client library" style — see `sparql-connector.ts`) rather than pulling in a
 * full grammar/highlighting package for what only ever needs to color a handful of token kinds.
 *
 * Not a validating parser: on malformed input it degrades to plain-text runs rather than
 * throwing, since this only ever feeds a `{@html}` highlight overlay, never the actual
 * parse/validate path (`turtle.ts` owns that).
 */

interface TokenPattern {
	type: string;
	re: RegExp;
}

// Order matters: each pattern is tried in turn at the current position, so more specific forms
// (comments, strings, IRIs) must come before the generic prefixed-name/keyword fallbacks.
const TOKEN_PATTERNS: TokenPattern[] = [
	{ type: 'comment', re: /^#[^\n]*/ },
	{ type: 'string', re: /^(?:"""[\s\S]*?"""|'''[\s\S]*?''')/ },
	{ type: 'string', re: /^(?:"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/ },
	{ type: 'iri', re: /^<[^>\s]*>/ },
	{ type: 'bnode', re: /^_:[\w.-]+/ },
	{ type: 'at', re: /^@[A-Za-z]+(?:-[A-Za-z0-9]+)*/ },
	{ type: 'prefixed', re: /^(?:[A-Za-z][\w-]*)?:(?:[A-Za-z_][\w.-]*)?/ },
	{
		type: 'number',
		re: /^[+-]?(?:\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)/
	},
	{ type: 'keyword', re: /^a(?=[\s.,;)\]}]|$)/ },
	{ type: 'punctuation', re: /^[.,;{}()[\]]/ },
	{ type: 'whitespace', re: /^[ \t\r\n]+/ }
];

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders `text` as HTML with each Turtle token wrapped in a `<span class="ttl-{type}">`. */
export function highlightTurtle(text: string): string {
	let out = '';
	let pos = 0;

	while (pos < text.length) {
		const slice = text.slice(pos);
		const match = TOKEN_PATTERNS.map((p) => ({ p, m: p.re.exec(slice) })).find(
			({ m }) => m !== null
		);

		if (!match || !match.m) {
			// No pattern matched (stray character) — emit as plain text and advance by one so we
			// always make progress.
			out += escapeHtml(text[pos]);
			pos += 1;
			continue;
		}

		const value = match.m[0];
		pos += value.length;

		if (match.p.type === 'whitespace') {
			out += escapeHtml(value);
		} else {
			out += `<span class="ttl-${match.p.type}">${escapeHtml(value)}</span>`;
		}
	}

	return out;
}
