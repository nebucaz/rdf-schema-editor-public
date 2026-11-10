import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import type { ChangeRequestDraft } from './change-request';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '#lib/config.js';
import {
	CHANGE_REQUEST_CLASS_IRI,
	CR_BASELINE_PREDICATE_IRI,
	CR_QUESTION_PREDICATE_IRI,
	CR_STATUS_PREDICATE_IRI
} from '#lib/utils/iri.js';

const SCHEMA = namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema;
const iri = `${SCHEMA}#ChangeRequestA`;
const draft: ChangeRequestDraft = {
	title: 'Add "Bank"', requestor: 'alice', proposedTerm: 'Bank', proposedDefinition: 'A financial institution.',
	proposedRelations: 'Bank has Account', rationale: 'CQ-3', questionIri: `${SCHEMA}#Cq3`, changeKind: 'addition'
};

type Row = Record<string, { value: string } | undefined>;
function mockFetch(select: (q: string) => Row[] = () => []) {
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_u: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response('{}', { status: 200 });
		}
		queries.push(body.query);
		if (body.query.includes('ASK')) return new Response(JSON.stringify({ boolean: true }), { status: 200 });
		return new Response(JSON.stringify({ head: { vars: [] }, results: { bindings: select(body.query) } }), { status: 200 });
	});
	return { fn, updates, queries };
}
const connector = () => new SparqlConnector('/api/sparql');
afterEach(() => vi.unstubAllGlobals());

describe('SparqlConnector change requests (STORY-332)', () => {
	it('stores a new request as open, with the baseline and escaped text', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const created = await connector().insertChangeRequest(draft, { questions: { q: 'pass' }, findings: [] });
		expect(created).toMatch(new RegExp(`^${SCHEMA}#ChangeRequest`));
		const u = updates.at(-1)!;
		expect(u).toContain(`GRAPH <${SCHEMA}>`);
		expect(u).toContain(`<${CHANGE_REQUEST_CLASS_IRI}>`);
		expect(u).toContain(`<${CR_STATUS_PREDICATE_IRI}> "open"`);
		expect(u).toContain('Add \\"Bank\\"');
		expect(u).toContain(`<${CR_QUESTION_PREDICATE_IRI}> <${draft.questionIri}>`);
		expect(u).toContain(`<${CR_BASELINE_PREDICATE_IRI}>`);
	});

	it('leaves out the question triple when none is linked, and refuses an invalid draft', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().insertChangeRequest({ ...draft, questionIri: '' }, null);
		expect(updates.at(-1)!).not.toContain(CR_QUESTION_PREDICATE_IRI);
		await expect(connector().insertChangeRequest({ ...draft, title: '' }, null)).rejects.toThrow();
		await expect(connector().insertChangeRequest({ ...draft, questionIri: 'http://x/> }' }, null)).rejects.toThrow();
	});

	it('reads requests back, folding the JSON fields', async () => {
		const { fn } = mockFetch(() => [
			{
				r: { value: iri }, title: { value: 'T' }, requestor: { value: 'alice' }, term: { value: 'Bank' }, rationale: { value: 'why' },
				status: { value: 'in-review' }, kind: { value: 'addition' }, created: { value: '2026-01-01' },
				baseline: { value: '{"questions":{},"findings":[]}' }, impact: { value: 'not json' }
			}
		]);
		vi.stubGlobal('fetch', fn);
		const [r] = await connector().fetchChangeRequests();
		expect(r).toMatchObject({ iri, title: 'T', status: 'in-review', changeKind: 'addition', questionIri: '' });
		expect(r.baseline).toEqual({ questions: {}, findings: [] });
		expect(r.impact).toBeNull();
	});

	it('starts a review only on an open request', async () => {
		const open = mockFetch(() => [{ status: { value: 'open' }, q: { value: draft.questionIri } }]);
		vi.stubGlobal('fetch', open.fn);
		await connector().startChangeRequestReview(iri);
		expect(open.updates[0]).toContain('"in-review"');

		const decided = mockFetch(() => [{ status: { value: 'approved' }, q: { value: draft.questionIri } }]);
		vi.stubGlobal('fetch', decided.fn);
		await expect(connector().startChangeRequestReview(iri)).rejects.toThrow();
	});

	it('decides with a rationale, the decider and the date, in one request', async () => {
		const { fn, updates } = mockFetch(() => [{ status: { value: 'in-review' }, q: { value: draft.questionIri } }]);
		vi.stubGlobal('fetch', fn);
		await connector().decideChangeRequest(iri, 'approved', { rationale: 'fits "CQ-3"', decidedBy: 'steward' });
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('"approved"');
		expect(updates[0]).toContain('fits \\"CQ-3\\"');
		expect(updates[0]).toContain('"steward"');
	});

	it('refuses an outcome the request may not take', async () => {
		const { fn, updates } = mockFetch(() => [{ status: { value: 'open' } }]);
		vi.stubGlobal('fetch', fn);
		await expect(connector().decideChangeRequest(iri, 'approved', { rationale: 'x', decidedBy: 'a' })).rejects.toThrow(/competency question/i);
		await expect(connector().decideChangeRequest(iri, 'returned', { rationale: ' ', decidedBy: 'a' })).rejects.toThrow(/rationale/i);
		expect(updates).toHaveLength(0);
	});

	it('stores the impact assessment as JSON', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().saveChangeRequestImpact(iri, { questions: [], newFindings: [], resolvedFindings: [] });
		expect(updates[0]).toContain('crImpact');
	});
});
