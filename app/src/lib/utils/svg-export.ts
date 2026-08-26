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
	return svgText.replace(/(<svg[^>]*>)/, `$1${defsEl.outerHTML}`);
}
