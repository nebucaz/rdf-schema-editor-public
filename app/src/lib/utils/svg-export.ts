/**
 * Canvas -> standalone SVG export (STORY-067). Per the relation-plus ADR ("SVG export
 * serialization strategy"), this uses `html-to-image`'s `foreignObject`-based DOM serialization
 * rather than a hand-rolled pure-SVG re-render — it reuses `EntityNode`/`ExternalClassNode`'s real
 * HTML/CSS visuals with zero parallel-maintenance burden, at the cost of not being a strict-SVG-
 * consumer format (some vector editors/PDF converters choke on embedded HTML). That limitation is
 * surfaced to the user in the export UI, not hidden here.
 *
 * Reuses the same bounds-fit math xyflow's own docs recommend for image export
 * (`getNodesBounds`/`getViewportForBounds` applied to `.svelte-flow__viewport`), so the export
 * isn't a raw screen capture of whatever's currently panned/zoomed into view.
 */
import { toSvg } from 'html-to-image';
import { getNodesBounds, getViewportForBounds, type Edge, type Node } from '@xyflow/svelte';

const EXPORT_PADDING = 40;

/** Edges/relation arrowheads are drawn via `url(#relation-arrow)`/`url(#inheritance-arrow)`,
 *  whose `<marker>` defs live in a global `<svg aria-hidden="true">` in `+page.svelte`, outside
 *  the `.svelte-flow__viewport` subtree this module captures — so a standalone downloaded file
 *  needs its own copy of those defs to render arrowheads at all. */
const MARKER_DEFS_SELECTOR = 'svg[aria-hidden="true"] defs';

/**
 * Renders the current canvas (or, when `selectedNodeIds` is non-empty, just that subset and the
 * edges between them) to a standalone SVG string.
 *
 * `viewportEl` is `.svelte-flow__viewport` — the pannable/zoomable layer holding both nodes and
 * edges in flow-space coordinates, found via `document.querySelector` at the call site since this
 * app's canvas page has no `<SvelteFlowProvider>` ancestor to pull it from a hook.
 */
export async function exportCanvasAsSvg(
	viewportEl: HTMLElement,
	nodes: Node[],
	edges: Edge[],
	selectedNodeIds: ReadonlySet<string>
): Promise<string> {
	const exportNodes = selectedNodeIds.size > 0 ? nodes.filter((n) => selectedNodeIds.has(n.id)) : nodes;
	if (exportNodes.length === 0) {
		throw new Error('Nothing to export');
	}
	const exportNodeIds = new Set(exportNodes.map((n) => n.id));
	const exportEdgeIds = new Set(
		edges.filter((e) => exportNodeIds.has(e.source) && exportNodeIds.has(e.target)).map((e) => e.id)
	);

	const bounds = getNodesBounds(exportNodes);
	const width = Math.ceil(bounds.width + EXPORT_PADDING * 2);
	const height = Math.ceil(bounds.height + EXPORT_PADDING * 2);
	const viewport = getViewportForBounds(bounds, width, height, 1, 1, EXPORT_PADDING);

	// The export should show the diagram as authored, not mid-editing selection chrome (a node's
	// accent box-shadow ring, xyflow's own edge-stroke override) — `html-to-image` clones the live
	// DOM as-is, so whatever's currently selected on screen would otherwise leak into the file.
	// Must run *before* `bakeSvgComputedStyle` so the baked-in edge colors reflect the deselected
	// look, not whatever happened to be selected at export time.
	const restoreSelectionStyling = suppressSelectionStyling(viewportEl);
	const restoreBakedSvgStyle = bakeSvgComputedStyle(viewportEl);
	try {
		const dataUrl = await toSvg(viewportEl, {
			width,
			height,
			style: {
				width: `${width}px`,
				height: `${height}px`,
				transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
			},
			filter: (domNode) => isIncludedInExport(domNode, exportNodeIds, exportEdgeIds)
		});

		const svgText = await dataUrlToText(dataUrl);
		return injectMarkerDefs(svgText);
	} finally {
		restoreBakedSvgStyle();
		restoreSelectionStyling();
	}
}

/**
 * `html-to-image`'s computed-style inlining (`getComputedStyle` baked onto each cloned node before
 * serializing) only reliably applies to HTML elements — true SVG-namespace elements nested inside
 * the captured subtree (every edge's own `<svg class="svelte-flow__edge-wrapper">` -> `<g>` ->
 * `<path class="svelte-flow__edge-path">`) come out with **no** inline style at all in the export,
 * even though their actual color/width is entirely CSS-class-driven
 * (`@xyflow/svelte/dist/style.css`'s `.svelte-flow__edge-path { stroke: var(...); ... }`) — so every
 * edge line renders with browser SVG defaults (`stroke: none`) in a standalone file: invisible.
 * Fixed the same way as `suppressSelectionStyling`: temporarily bake each real SVG element's own
 * live computed paint properties onto its own inline `style` attribute before capture (a literal
 * attribute value always survives cloning, unlike computed style), then restore the original
 * attribute value afterward regardless of success or failure.
 */
function bakeSvgComputedStyle(viewportEl: HTMLElement): () => void {
	const svgEls = Array.from(viewportEl.querySelectorAll<SVGElement>('svg, g, path'));
	const restore: Array<() => void> = [];
	for (const el of svgEls) {
		const previousStyle = el.getAttribute('style');
		const computed = window.getComputedStyle(el);
		el.setAttribute(
			'style',
			`${previousStyle ?? ''}; stroke: ${computed.stroke}; stroke-width: ${computed.strokeWidth}; ` +
				`stroke-dasharray: ${computed.strokeDasharray}; fill: ${computed.fill};`
		);
		restore.push(() => {
			if (previousStyle === null) el.removeAttribute('style');
			else el.setAttribute('style', previousStyle);
		});
	}
	return () => restore.forEach((fn) => fn());
}

/** Strips xyflow's `selected` class from every currently-selected node/edge within the captured
 *  subtree so the export never bakes in the accent box-shadow ring or edge-stroke-selected color
 *  override, then returns a callback restoring it — called from a `finally` so the live canvas's
 *  selection is never left visibly altered, whether the capture succeeds or throws. */
function suppressSelectionStyling(viewportEl: HTMLElement): () => void {
	const selectedEls = Array.from(viewportEl.querySelectorAll('.selected'));
	for (const el of selectedEls) el.classList.remove('selected');
	return () => {
		for (const el of selectedEls) el.classList.add('selected');
	};
}

/** Excluding a node also excludes its children (html-to-image's own contract), so filtering out
 *  a `.svelte-flow__node`/`.svelte-flow__edge` whose id isn't in the export set is enough — no
 *  need to separately filter the controls/minimap/attribution chrome, since those live outside
 *  `.svelte-flow__viewport` entirely and are never part of the captured subtree. */
function isIncludedInExport(
	domNode: HTMLElement,
	nodeIds: ReadonlySet<string>,
	edgeIds: ReadonlySet<string>
): boolean {
	const classList = domNode.classList;
	if (!classList) return true;
	if (classList.contains('svelte-flow__node')) {
		return nodeIds.has(domNode.getAttribute('data-id') ?? '');
	}
	if (classList.contains('svelte-flow__edge')) {
		return edgeIds.has(domNode.getAttribute('data-id') ?? '');
	}
	return true;
}

async function dataUrlToText(dataUrl: string): Promise<string> {
	const response = await fetch(dataUrl);
	return response.text();
}

function injectMarkerDefs(svgText: string): string {
	const defsEl = document.querySelector(MARKER_DEFS_SELECTOR);
	if (!defsEl) return svgText;
	return svgText.replace(/(<svg[^>]*>)/, `$1${inlineMarkerPathColors(defsEl)}`);
}

/**
 * `relation-arrow`/`ismasterfor-arrow`'s paths (`+page.svelte`) get their actual stroke/fill color
 * from page-level `<style>` rules keyed on their `id` (`:global(#relation-arrow-path) { stroke: ... }`,
 * themed for light/dark) rather than an inline `style` attribute — appropriate for the live page,
 * but a plain `outerHTML` copy carries no stylesheet with it, so those two markers would render with
 * no stroke/fill at all in a standalone export (SVG paint defaults to `none`), making every plain
 * relation edge's arrowhead invisible. Baking each path's live *computed* `stroke`/`fill` onto its own
 * clone before embedding makes the copy self-contained regardless of whether a given marker's color
 * happens to be inline or CSS-driven, and automatically follows whichever theme is active right now.
 */
function inlineMarkerPathColors(defsEl: Element): string {
	const clone = defsEl.cloneNode(true) as Element;
	const livePaths = defsEl.querySelectorAll('path');
	const clonedPaths = clone.querySelectorAll('path');
	livePaths.forEach((livePath, i) => {
		const clonedPath = clonedPaths[i];
		if (!clonedPath) return;
		const computed = window.getComputedStyle(livePath);
		const existingStyle = clonedPath.getAttribute('style') ?? '';
		clonedPath.setAttribute('style', `${existingStyle}; stroke: ${computed.stroke}; fill: ${computed.fill};`);
	});
	return clone.outerHTML;
}
