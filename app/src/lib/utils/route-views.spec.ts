import { describe, it, expect } from 'vitest';
import { resolveRouteView } from './route-views';

describe('resolveRouteView', () => {
	it('treats / as the canvas', () => {
		expect(resolveRouteView('/')).toEqual({
			isIdentitiesView: false,
			isValidationView: false,
			isWorkbenchView: false,
			isReportView: false,
			isCanvasView: true
		});
	});

	it('flags /workbench and nested paths as the workbench, not the canvas', () => {
		for (const p of ['/workbench', '/workbench/anything']) {
			const v = resolveRouteView(p);
			expect(v.isWorkbenchView).toBe(true);
			expect(v.isCanvasView).toBe(false);
			expect(v.isIdentitiesView).toBe(false);
		}
	});

	it('flags /reports/<id> as the report view, not the canvas', () => {
		const v = resolveRouteView('/reports/ProdAppsSavedQuery');
		expect(v.isReportView).toBe(true);
		expect(v.isCanvasView).toBe(false);
		expect(v.isWorkbenchView).toBe(false);
	});

	it('keeps identities and validation off the canvas', () => {
		expect(resolveRouteView('/identities').isCanvasView).toBe(false);
		expect(resolveRouteView('/validation').isCanvasView).toBe(false);
		expect(resolveRouteView('/identities').isIdentitiesView).toBe(true);
		expect(resolveRouteView('/validation').isValidationView).toBe(true);
	});
});
