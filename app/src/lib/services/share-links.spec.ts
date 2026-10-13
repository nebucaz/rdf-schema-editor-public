import { describe, it, expect } from 'vitest';
import { savedQueryLinks, adHocLink, adHocReportLink, AD_HOC_REPORT_ID, resolveSharedLoad } from './share-links';
import { reportIdForIri } from './report-id';
import { DEFAULT_NAMESPACE_BASE_IRI, namespaceGraphs } from '../config';
import { emptyQueryModel, encodeModelForUrl, serializeQueryModel } from './query-model';
import type { SavedQueryItem } from './saved-queries';

const BASE = `${namespaceGraphs(DEFAULT_NAMESPACE_BASE_IRI).schema}#`;
const ORIGIN = 'https://rse.example.org';
const model = emptyQueryModel('http://example.org/ns#App', ['http://example.org/ns']);

const item = (over: Partial<SavedQueryItem> = {}): SavedQueryItem => ({
	iri: `${BASE}FooSavedQuery`,
	label: 'Foo',
	description: '',
	kind: 'builder',
	creator: '',
	mine: false,
	sparqlText: '',
	queryModel: serializeQueryModel(model),
	...over
});

describe('savedQueryLinks', () => {
	it('builds the builder and report links from the same id', () => {
		const links = savedQueryLinks(ORIGIN, `${BASE}FooSavedQuery`);
		expect(links.builder).toBe(`${ORIGIN}/workbench?query=FooSavedQuery`);
		expect(links.report).toBe(`${ORIGIN}/reports/FooSavedQuery`);
	});

	it('url-encodes ids outside the default graph', () => {
		const iri = 'http://other.example/ns#X?y';
		const id = reportIdForIri(iri);
		const links = savedQueryLinks(ORIGIN, iri);
		expect(links.builder).toBe(`${ORIGIN}/workbench?query=${encodeURIComponent(id)}`);
		expect(links.report).toBe(`${ORIGIN}/reports/${encodeURIComponent(id)}`);
	});
});

describe('adHocLink', () => {
	it('encodes the model into ?m= and round-trips through resolveSharedLoad', () => {
		const link = adHocLink(ORIGIN, model);
		expect(link.ok).toBe(true);
		if (!link.ok) return;
		const params = new URL(link.url).searchParams;
		expect(new URL(link.url).pathname).toBe('/workbench');
		const r = resolveSharedLoad(params, []);
		expect(r.kind).toBe('model');
		if (r.kind === 'model') expect(r.model).toEqual(model);
	});

	it('refuses an over-long model with a "save it first" message', () => {
		const big = { ...model, filters: Array.from({ length: 300 }, (_, i) => ({
			id: `f${i}`, hopId: null, propertyIri: `http://example.org/ns#p${i}`, op: 'eq' as const, value: `v${i}`
		})) };
		const link = adHocLink(ORIGIN, big);
		expect(link.ok).toBe(false);
		if (!link.ok) expect(link.error).toMatch(/save/i);
	});
});

describe('resolveSharedLoad', () => {
	it('is none without a query or m parameter', () => {
		expect(resolveSharedLoad(new URLSearchParams(''), []).kind).toBe('none');
		expect(resolveSharedLoad(new URLSearchParams('foo=1'), []).kind).toBe('none');
	});

	it('opens a saved builder query by id', () => {
		const r = resolveSharedLoad(new URLSearchParams('query=FooSavedQuery'), [item()]);
		expect(r.kind).toBe('model');
		if (r.kind === 'model') expect(r.model).toEqual(model);
	});

	it('hands a legacy raw-SPARQL query to the console', () => {
		const r = resolveSharedLoad(new URLSearchParams('query=FooSavedQuery'), [
			item({ kind: 'sparql', queryModel: undefined, sparqlText: 'SELECT 1' })
		]);
		expect(r).toEqual({ kind: 'console', text: 'SELECT 1' });
	});

	it('reports an unknown saved query and a corrupt stored model as friendly errors', () => {
		const missing = resolveSharedLoad(new URLSearchParams('query=NopeSavedQuery'), [item()]);
		expect(missing.kind).toBe('error');
		const corrupt = resolveSharedLoad(new URLSearchParams('query=FooSavedQuery'), [item({ queryModel: '{oops' })]);
		expect(corrupt.kind).toBe('error');
	});

	it('loads nothing for a malformed or tampered m parameter', () => {
		for (const bad of ['m=!!!', 'm=abc', `m=${'A'.repeat(5000)}`]) {
			const r = resolveSharedLoad(new URLSearchParams(bad), []);
			expect(r.kind, bad.slice(0, 12)).toBe('error');
		}
		const enc = encodeModelForUrl(model);
		if (!enc.ok) throw new Error('encode');
		const tampered = enc.param.slice(0, -3) + 'AAA';
		expect(['error', 'model']).toContain(resolveSharedLoad(new URLSearchParams(`m=${tampered}`), []).kind);
	});

	it('prefers a saved query id over an inline model when both are present', () => {
		const enc = encodeModelForUrl(emptyQueryModel('http://example.org/ns#Other', ['http://example.org/ns']));
		if (!enc.ok) throw new Error('encode');
		const r = resolveSharedLoad(new URLSearchParams(`query=FooSavedQuery&m=${enc.param}`), [item()]);
		expect(r.kind === 'model' && r.model.root.classIri).toBe('http://example.org/ns#App');
	});
});

describe('adHocReportLink', () => {
	it('builds a read-only result link whose ?m= decodes back to the model', () => {
		const link = adHocReportLink(ORIGIN, model);
		expect(link.ok).toBe(true);
		if (!link.ok) return;
		const url = new URL(link.url);
		expect(url.pathname).toBe(`/reports/${AD_HOC_REPORT_ID}`);
		const r = resolveSharedLoad(url.searchParams, []);
		expect(r.kind).toBe('model');
		if (r.kind === 'model') expect(r.model).toEqual(model);
	});

	it('cannot collide with a saved-query report id (those are PascalCase local names or ~-encoded)', () => {
		expect(reportIdForIri(`${BASE}AdhocSavedQuery`)).not.toBe(AD_HOC_REPORT_ID);
		expect(AD_HOC_REPORT_ID).toBe('adhoc');
	});
});
