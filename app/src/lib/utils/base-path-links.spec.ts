import { describe, expect, it, vi } from 'vitest';

// Every link builder with APP_BASE_PATH=/path (STORY-008).
vi.mock('#lib/utils/urls.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/utils/urls.js')>();
	return { ...original, ...original.createUrls({ appBasePath: '/path', apiPrefix: '/p' }) };
});

import { adHocLink, adHocReportLink, resolveSharedLoad, savedQueryLinks } from '#lib/services/share-links.js';
import { shareLinkFor, shortLinkUrl } from '#lib/services/short-links.js';
import type { QueryModel } from '#lib/services/query-model.js';
import { buildIdentitySearchUrl, parseIdentitySearchParams } from './identity-search-url';
import { resolveRouteView } from './route-views';

const ORIGIN = 'https://h.example';

describe('route views under a base path', () => {
	it('detect the view from the pathname with the base stripped', () => {
		expect(resolveRouteView('/path/workbench').isWorkbenchView).toBe(true);
		expect(resolveRouteView('/path/identities').isIdentitiesView).toBe(true);
		expect(resolveRouteView('/path/validation').isValidationView).toBe(true);
		expect(resolveRouteView('/path/questions').isQuestionsView).toBe(true);
		expect(resolveRouteView('/path/questions').isCanvasView).toBe(false);
		expect(resolveRouteView('/path/pipeline').isPipelineView).toBe(true);
		expect(resolveRouteView('/path/pipeline').isCanvasView).toBe(false);
		expect(resolveRouteView('/path/vocabulary').isVocabularyView).toBe(true);
		expect(resolveRouteView('/path/vocabulary').isCanvasView).toBe(false);
		const report = resolveRouteView('/path/reports/Abc');
		expect(report.isReportView).toBe(true);
		expect(report.isCanvasView).toBe(false);
		expect(resolveRouteView('/path/').isCanvasView).toBe(true);
		expect(resolveRouteView('/path').isCanvasView).toBe(true);
	});
});

describe('identity search URLs under a base path', () => {
	it('carry the base and still round-trip through parse', () => {
		const url = buildIdentitySearchUrl({ node: 'http://x/y', query: 'a b' });
		expect(url.startsWith('/path/identities?')).toBe(true);
		expect(parseIdentitySearchParams(url.slice(url.indexOf('?')))).toMatchObject({ node: 'http://x/y', query: 'a b' });
		expect(buildIdentitySearchUrl({})).toBe('/path/identities');
	});
});

describe('share links under a base path', () => {
	const model = { version: 1 } as unknown as QueryModel;

	it('saved query links', () => {
		const { builder, report } = savedQueryLinks(ORIGIN, 'http://ld.pageagent.com/rdf-schema-editor#MyQuery');
		expect(builder.startsWith(`${ORIGIN}/path/workbench?query=`)).toBe(true);
		expect(report.startsWith(`${ORIGIN}/path/reports/`)).toBe(true);
	});

	it('ad-hoc and short links', () => {
		const inline = adHocLink(ORIGIN, model);
		if (inline.ok) expect(inline.url.startsWith(`${ORIGIN}/path/workbench?m=`)).toBe(true);
		const result = adHocReportLink(ORIGIN, model);
		if (result.ok) expect(result.url.startsWith(`${ORIGIN}/path/reports/adhoc?m=`)).toBe(true);
		const plan = shareLinkFor(ORIGIN, model);
		if (plan.kind === 'inline') expect(plan.url.startsWith(`${ORIGIN}/path/workbench?m=`)).toBe(true);
		expect(shortLinkUrl(ORIGIN, 'aZ09aZ09aZ')).toBe(`${ORIGIN}/path/workbench?q=aZ09aZ09aZ`);
	});
});

describe('shared-link resolution under a base path', () => {
	it('reads only the query string, never the pathname', () => {
		expect(resolveSharedLoad(new URLSearchParams('query=Missing'), [])).toMatchObject({ kind: 'error' });
		expect(resolveSharedLoad(new URLSearchParams(''), [])).toEqual(resolveSharedLoad(new URLSearchParams(), []));
	});
});
