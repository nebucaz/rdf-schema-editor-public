/**
 * Mock GraphDB answers for spec/loop-issues STORY-313: the rows a cross-graph SELECT returns when the same
 * triple lives in two graphs and a resource carries two labels. Real GraphDB sends these ungrouped rows to a
 * connector that does not collapse them, which made keyed `{#each}` lists throw `each_key_duplicate`.
 * Shared by `sparql-connector.spec.ts` and the Edit-flow component spec; only the answers are canned, so
 * the connector's own grouping/dedupe is what the specs exercise.
 */

export const FIXTURE_NS = 'urn:fixture';
export const FIXTURE_INDIVIDUAL = `${FIXTURE_NS}#thing`;
export const FIXTURE_PREDICATE = `${FIXTURE_NS}/schema#state`;
export const FIXTURE_OBJECT = 'urn:enum#Freigegeben';
export const FIXTURE_CLASS = `${FIXTURE_NS}#Widget`;

const uri = (value: string) => ({ type: 'uri', value });
const lit = (value: string) => ({ type: 'literal', value });

/** The one assertion, repeated once per object label x graph. */
export const ASSERTION_ROWS = ['Freigegeben', 'Freigegeben', 'Released'].map((objectLabel) => ({
	p: uri(FIXTURE_PREDICATE),
	plabel: lit('state'),
	o: uri(FIXTURE_OBJECT),
	olabel: lit(objectLabel)
}));

/** The same individual `a <Widget>` in two instance graphs, one with a second label. */
export const INDIVIDUAL_ROWS = [
	{ i: uri(`${FIXTURE_NS}#a`), label: lit('Alpha'), g: uri('urn:zeta') },
	{ i: uri(`${FIXTURE_NS}#a`), label: lit('Alpha'), g: uri(FIXTURE_NS) },
	{ i: uri(`${FIXTURE_NS}#a`), label: lit('Alpha 2'), g: uri(FIXTURE_NS) },
	{ i: uri(`${FIXTURE_NS}#b`), label: lit('Beta'), g: uri(FIXTURE_NS) }
];

/** A `fetch` stand-in answering the Edit-flow reads with the rows above; `calls` collects every query sent. */
export function twoGraphFetch() {
	const calls: string[] = [];
	const respond = (bindings: unknown[]) =>
		new Response(JSON.stringify({ head: { vars: [] }, results: { bindings } }), { status: 200 });
	const fetchImpl = async (_url: string, opts: { body: string }) => {
		const query: string = JSON.parse(opts.body).query;
		calls.push(query);
		if (query.includes('AS ?plabel')) return respond(ASSERTION_ROWS);
		if (query.includes('GROUP BY ?i')) return respond(INDIVIDUAL_ROWS);
		if (query.includes('a ?type')) return respond([{ g: uri(FIXTURE_NS) }]);
		return respond([]);
	};
	return { fetchImpl, calls };
}
