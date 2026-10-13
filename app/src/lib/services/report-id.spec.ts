import { describe, it, expect } from 'vitest';
import { reportIdForIri, iriForReportId, resolveReportTarget } from './report-id';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '../config';
import { emptyQueryModel, serializeQueryModel } from './query-model';
import type { SavedQueryItem } from './saved-queries';

const BASE = `${namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema}#`;

describe('report id mapping', () => {
	it('uses the local segment for a saved query minted under the default schema graph', () => {
		expect(reportIdForIri(`${BASE}ProdAppsSavedQuery`)).toBe('ProdAppsSavedQuery');
		expect(iriForReportId('ProdAppsSavedQuery')).toBe(`${BASE}ProdAppsSavedQuery`);
	});

	it('round-trips an IRI outside the default graph through a URL-safe encoding', () => {
		const iri = 'http://other.example/ns/schema#Zähler/ä?x=1';
		const id = reportIdForIri(iri);
		expect(id).toMatch(/^~[A-Za-z0-9_-]+$/);
		expect(iriForReportId(id)).toBe(iri);
	});

	it('round-trips the default-graph IRI too', () => {
		const iri = `${BASE}AnySavedQuery`;
		expect(iriForReportId(reportIdForIri(iri))).toBe(iri);
	});

	it('rejects ids that are neither a plain local name nor a valid encoding', () => {
		for (const bad of ['', 'has space', 'a/b', 'a#b', 'a>b', '"x"', '~', '~!!!', '..', 'a%20b']) {
			expect(iriForReportId(bad)).toBeNull();
		}
	});

	it('rejects an encoded id that does not decode to an http(s) IRI', () => {
		const enc = (s: string) =>
			'~' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		expect(iriForReportId(enc('javascript:alert(1)'))).toBeNull();
		expect(iriForReportId(enc('http://x/a>b'))).toBeNull();
	});
});

const item = (over: Partial<SavedQueryItem>): SavedQueryItem => ({
	iri: `${BASE}FooSavedQuery`,
	label: 'Foo',
	description: '',
	kind: 'builder',
	creator: '',
	mine: false,
	sparqlText: '',
	...over
});

describe('resolveReportTarget', () => {
	const model = emptyQueryModel('http://example.org/ns#App', ['http://example.org/ns']);

	it('is notFound for an unknown or malformed id', () => {
		expect(resolveReportTarget([item({})], 'NopeSavedQuery').kind).toBe('notFound');
		expect(resolveReportTarget([item({})], 'bad id').kind).toBe('notFound');
	});

	it('resolves a builder query with its parsed model', () => {
		const r = resolveReportTarget([item({ queryModel: serializeQueryModel(model) })], 'FooSavedQuery');
		expect(r.kind).toBe('ready');
		if (r.kind === 'ready') {
			expect(r.model).toEqual(model);
			expect(r.item.label).toBe('Foo');
		}
	});

	it('resolves a legacy raw-SPARQL query as a fallback with its text', () => {
		const r = resolveReportTarget(
			[item({ kind: 'sparql', sparqlText: 'SELECT * WHERE {?s ?p ?o}' })],
			'FooSavedQuery'
		);
		expect(r).toMatchObject({ kind: 'legacy', text: 'SELECT * WHERE {?s ?p ?o}' });
	});

	it('reports a corrupt model as a readable error, not a throw', () => {
		const r = resolveReportTarget([item({ queryModel: '{not json' })], 'FooSavedQuery');
		expect(r.kind).toBe('invalid');
		if (r.kind === 'invalid') expect(r.message).toMatch(/Foo/);
	});
});
