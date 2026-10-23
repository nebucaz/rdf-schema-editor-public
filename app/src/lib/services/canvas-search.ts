/**
 * Canvas search (canvas-navigation Story 005): a pure matcher over the nodes currently on the canvas,
 * plus the CSS that highlights matches and dims everything else. Only visible class (`entity`) nodes
 * are searched — individuals, external classes and notes are out of scope — so the same hidden-node
 * rule that governs rendering (other workspace, hidden namespace) governs matching.
 */

export interface SearchableNode {
	id: string;
	type?: string;
	hidden?: boolean;
	data: Record<string, unknown>;
}

export interface SearchMatch {
	id: string;
	name: string;
}

export function searchCanvasNodes(nodes: SearchableNode[], query: string): SearchMatch[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [];
	return nodes
		.filter((n) => n.type === 'entity' && !n.hidden && typeof n.data.name === 'string')
		.map((n) => ({ id: n.id, name: n.data.name as string }))
		.filter((m) => m.name.toLowerCase().includes(needle))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Escapes a value for use inside a double-quoted CSS attribute selector string. */
function cssString(value: string): string {
	// `<` is hex-escaped so an id can never close the surrounding <style> element.
	return value
		.replace(/[\\"]/g, '\\$&')
		.replace(/[\n\r\f]/g, ' ')
		.replace(/</g, '\\3c ');
}

/**
 * Stylesheet scoped to the canvas: while a search is active every node is dimmed and the matches
 * (selected by Svelte Flow's `data-id`) are restored with an accent ring. Empty while idle.
 */
export function searchHighlightCss(query: string, matchIds: string[]): string {
	if (!query.trim()) return '';
	const dim = '.canvas-wrap .svelte-flow__node { opacity: 0.25; transition: opacity 0.15s; }';
	if (matchIds.length === 0) return dim;
	const selector = matchIds.map((id) => `.canvas-wrap .svelte-flow__node[data-id="${cssString(id)}"]`).join(',\n');
	return `${dim}\n${selector} { opacity: 1; filter: drop-shadow(0 0 6px var(--color-accent, #007acc)); }`;
}

/** A search hit is never shown smaller than this, however far the canvas is zoomed out. */
export const MIN_PAN_ZOOM = 0.5;

/**
 * Viewport that puts a node's center on the canvas center (keeping the zoom, but never below
 * `MIN_PAN_ZOOM`), for jumping to a search result. `size` is the node's measured size.
 */
export function panToNode(
	viewport: { x: number; y: number; zoom: number },
	canvasWidth: number,
	canvasHeight: number,
	position: { x: number; y: number },
	size: { width: number; height: number }
): { x: number; y: number; zoom: number } {
	const width = canvasWidth || 800;
	const height = canvasHeight || 600;
	const zoom = Math.max(viewport.zoom, MIN_PAN_ZOOM);
	return {
		x: width / 2 - (position.x + size.width / 2) * zoom,
		y: height / 2 - (position.y + size.height / 2) * zoom,
		zoom
	};
}
