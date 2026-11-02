/**
 * Which top-level surface a pathname belongs to. `+layout.svelte` uses this to hide canvas-only
 * chrome (workspace/namespace selectors, triples, SVG export, …) on the non-canvas routes.
 * `isCanvasView` is true only on the canvas route itself, not merely "not identities".
 */
import { stripBase } from '#lib/utils/urls.js';

export interface RouteView {
	isIdentitiesView: boolean;
	isValidationView: boolean;
	isWorkbenchView: boolean;
	/** `/reports/<id>` — a saved query's live report page (query-workbench STORY-198). */
	isReportView: boolean;
	isCanvasView: boolean;
}

export function resolveRouteView(browserPathname: string): RouteView {
	// `page.url.pathname` includes the deployment base path; the route checks below do not.
	const pathname = stripBase(browserPathname);
	const isIdentitiesView = pathname.startsWith('/identities');
	const isValidationView = pathname.startsWith('/validation');
	const isWorkbenchView = pathname.startsWith('/workbench');
	const isReportView = pathname.startsWith('/reports');
	return {
		isIdentitiesView,
		isValidationView,
		isWorkbenchView,
		isReportView,
		isCanvasView: !isIdentitiesView && !isValidationView && !isWorkbenchView && !isReportView
	};
}
