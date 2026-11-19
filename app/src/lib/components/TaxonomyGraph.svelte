<script lang="ts">
	/**
	 * Read-only graph of one SKOS scheme (vocabulary-graph-and-tabs STORY-452): the `buildSchemeGraph` model drawn as
	 * SVG with plain `d3` zoom and pan, like `IdentityNeighborhoodGraph`. It reads nothing and writes nothing, so the
	 * review pages can use it; clicking a concept only calls `onOpen`.
	 */
	import * as d3 from 'd3';
	import { buildSchemeGraph, type GraphLinkKind, type GraphNode } from '#lib/services/concept-graph.js';
	import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';

	interface Props {
		concepts: Concept[];
		schemes: ConceptScheme[];
		schemeIri: string;
		onOpen: (iri: string) => void;
		maxNodes?: number;
	}

	let { concepts, schemes, schemeIri, onOpen, maxNodes }: Props = $props();

	let related = $state(true);
	let mappings = $state(true);
	let layout = $state<'tree' | 'radial'>('tree');
	let expanded = $state<string[]>([]);

	const graph = $derived(
		buildSchemeGraph(concepts, schemes, { schemeIri, maxNodes, layout, expanded, layers: { related, mappings } })
	);
	const statusOf = $derived(new Map(concepts.map((c) => [c.iri, c.status])));
	const byId = $derived(new Map(graph.nodes.map((n) => [n.id, n])));

	// Nodes can be dragged to untangle crossing lines. The positions live only in this view (nothing is saved) and
	// are dropped when the layout, the scheme or the expanded branches change, because the model then places nodes anew.
	let moved = $state<Record<string, { x: number; y: number }>>({});
	const at = (n: { id: string; x: number; y: number }) => moved[n.id] ?? n;
	$effect(() => {
		void layout;
		void schemeIri;
		void expanded;
		moved = {};
	});

	function draggable(el: SVGGElement, id: string) {
		const behavior = d3
			.drag<SVGGElement, unknown>()
			.subject(() => {
				const n = byId.get(id);
				return n ? { ...at(n) } : { x: 0, y: 0 };
			})
			.on('drag', (event) => {
				moved = { ...moved, [id]: { x: event.x, y: event.y } };
			});
		d3.select(el).call(behavior);
		return { destroy: () => void d3.select(el).on('.drag', null) };
	}

	const NODE_W = 120;
	const NODE_H = 30;
	const MARKER_TEXT: Record<string, string> = {
		orphan: 'orphan',
		cycle: 'cycle',
		'multiple-parents': 'multiple parents',
		'top-with-broader': 'top concept with a broader concept'
	};

	let svgEl = $state<SVGSVGElement>();
	let transform = $state(d3.zoomIdentity);
	let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | undefined;

	$effect(() => {
		if (!svgEl) return;
		const behavior = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.extent((): [[number, number], [number, number]] => [[0, 0], [svgEl?.clientWidth || 800, svgEl?.clientHeight || 500]])
			.on('zoom', (event) => (transform = event.transform));
		zoomBehavior = behavior;
		d3.select(svgEl).call(behavior);
		return () => {
			d3.select(svgEl!).on('.zoom', null);
		};
	});

	function fit() {
		if (!svgEl || !zoomBehavior || graph.nodes.length === 0) return;
		const width = svgEl.clientWidth || 800;
		const height = svgEl.clientHeight || 500;
		const xs = graph.nodes.map((n) => n.x);
		const ys = graph.nodes.map((n) => n.y);
		const x0 = Math.min(...xs) - NODE_W / 2;
		const x1 = Math.max(...xs) + NODE_W / 2;
		const y0 = Math.min(...ys) - NODE_H;
		const y1 = Math.max(...ys) + NODE_H;
		const k = Math.min(2, 0.9 * Math.min(width / (x1 - x0), height / (y1 - y0)));
		const t = d3.zoomIdentity
			.translate(width / 2 - (k * (x0 + x1)) / 2, height / 2 - (k * (y0 + y1)) / 2)
			.scale(k);
		d3.select(svgEl).call(zoomBehavior.transform, t);
	}

	// Frame the graph whenever its shape changes (a new scheme, another layout, an expanded branch).
	$effect(() => {
		void graph.nodes.length;
		void layout;
		fit();
	});

	function nodeLabel(n: GraphNode): string {
		const notes = n.markers.map((m) => MARKER_TEXT[m] ?? m);
		if (n.duplicateOf) notes.push('also appears under another broader concept');
		return `Open ${n.label}${notes.length ? ` (${notes.join(', ')})` : ''}`;
	}

	function onKey(event: KeyboardEvent, action: () => void) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			action();
		}
	}

	function clip(label: string): string {
		return label.length > 18 ? `${label.slice(0, 17)}…` : label;
	}

	const LINK_LABEL: Partial<Record<GraphLinkKind, string>> = { 'duplicate-of': 'same concept' };
</script>

<div class="taxonomy-graph">
	<div class="toolbar">
		<label><input type="checkbox" bind:checked={related} /> Related links</label>
		<label><input type="checkbox" bind:checked={mappings} /> Mapping links</label>
		<label>
			Layout
			<select bind:value={layout}>
				<option value="tree">Tree</option>
				<option value="radial">Radial</option>
			</select>
		</label>
		<button type="button" class="fit" onclick={fit}>Fit to view</button>
		<ul class="legend" aria-label="Legend">
			<li><svg class="swatch" width="32" height="8" aria-hidden="true"><line class="link broader" x1="0" y1="4" x2="32" y2="4" /></svg>Broader</li>
			<li><svg class="swatch" width="32" height="8" aria-hidden="true"><line class="link related" x1="0" y1="4" x2="32" y2="4" /></svg>Related</li>
			<li><svg class="swatch" width="32" height="8" aria-hidden="true"><line class="link exactMatch" x1="0" y1="4" x2="32" y2="4" /></svg>Mapping</li>
			<li><svg class="swatch" width="32" height="8" aria-hidden="true"><line class="link duplicate-of" x1="0" y1="4" x2="32" y2="4" /></svg>Same concept</li>
		</ul>
	</div>

	{#if graph.truncated}
		<p class="notice">Large scheme: the deepest levels are collapsed. Use a “+” control to show the next level.</p>
	{/if}

	<svg class="canvas" bind:this={svgEl} role="group" aria-label="Graph of {graph.schemeName}">
		<g transform={transform.toString()}>
			{#each graph.links as link (link.kind + link.from + link.to)}
				{@const a = byId.get(link.from)}
				{@const b = byId.get(link.to)}
				{#if a && b}
					<line
						class="link {link.kind}"
						data-link-kind={link.kind}
						x1={at(a).x}
						y1={at(a).y}
						x2={at(b).x}
						y2={at(b).y}
					>
						{#if LINK_LABEL[link.kind]}<title>{LINK_LABEL[link.kind]}</title>{/if}
					</line>
				{/if}
			{/each}

			{#each graph.nodes as node (node.id)}
				<g
					class="node"
					class:duplicate={!!node.duplicateOf}
					data-iri={node.iri}
					data-status={statusOf.get(node.iri) ?? 'active'}
					transform="translate({at(node).x}, {at(node).y})"
					use:draggable={node.id}
					role="button"
					tabindex="0"
					aria-label={nodeLabel(node)}
					onclick={() => onOpen(node.iri)}
					onkeydown={(e) => onKey(e, () => onOpen(node.iri))}
				>
					<rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx="6" />
					<text text-anchor="middle" dy="0.35em">{clip(node.label)}</text>
					<title>{node.label}</title>
					{#each node.markers as marker, i (marker)}
						<circle class="marker {marker}" cx={-NODE_W / 2 + 8 + i * 12} cy={-NODE_H / 2} r="4">
							<title>{MARKER_TEXT[marker] ?? marker}</title>
						</circle>
					{/each}
				</g>
				{#if node.hiddenChildren > 0}
					<g
						class="expand"
						transform="translate({at(node).x}, {at(node).y + NODE_H / 2 + 12})"
						role="button"
						tabindex="0"
						aria-label="Show {node.hiddenChildren} hidden concepts below {node.label}"
						onclick={() => (expanded = [...expanded, node.iri])}
						onkeydown={(e) => onKey(e, () => (expanded = [...expanded, node.iri]))}
					>
						<circle r="10" />
						<text text-anchor="middle" dy="0.35em">+{node.hiddenChildren}</text>
					</g>
				{/if}
			{/each}
		</g>
	</svg>
</div>

<style>
	.taxonomy-graph {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 24rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		font-size: 0.85rem;
		color: var(--color-text);
	}
	.fit {
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		border-radius: 4px;
		padding: 0.2rem 0.6rem;
		cursor: pointer;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.75rem;
		margin: 0 0 0 auto;
		padding: 0;
		list-style: none;
		line-height: 1;
		color: var(--color-text-muted);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
	}
	.swatch {
		display: block;
		width: 32px;
		min-height: 0;
		flex: none;
		height: 8px;
		overflow: visible;
	}
	.notice {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-warning);
	}
	svg.canvas {
		flex: 1;
		width: 100%;
		min-height: 22rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		cursor: grab;
	}
	.link {
		stroke: var(--graph-link-broader);
		stroke-width: 1.5;
	}
	.link.related {
		stroke: var(--graph-link-related);
		stroke-dasharray: 6 4;
	}
	.link.duplicate-of {
		stroke: var(--graph-link-same);
		stroke-width: 2.5;
		stroke-dasharray: 8 3 2 3;
	}
	.link:not(.broader):not(.related):not(.duplicate-of) {
		stroke: var(--graph-link-mapping);
		stroke-width: 2;
		stroke-dasharray: 2 4;
		stroke-linecap: round;
	}
	.node {
		cursor: grab;
	}
	.node rect {
		fill: var(--graph-node-fill);
		stroke: var(--color-accent);
		stroke-width: 1.5;
	}
	.node text,
	.expand text {
		fill: var(--color-text);
		font-size: 12px;
		pointer-events: none;
	}
	.node.duplicate rect {
		stroke-dasharray: 4 3;
	}
	.node[data-status='approved'] rect {
		stroke: var(--color-success);
	}
	.node[data-status='proposed'] rect {
		stroke: var(--color-text-muted);
	}
	.node[data-status='deprecated'],
	.node[data-status='retired'] {
		opacity: 0.5;
	}
	.node:focus-visible rect {
		stroke-width: 3;
	}
	.marker.orphan {
		fill: var(--color-warning);
	}
	.marker.cycle {
		fill: var(--color-error);
	}
	.marker.multiple-parents,
	.marker.top-with-broader {
		fill: var(--color-accent);
	}
	.expand {
		cursor: pointer;
	}
	.expand circle {
		fill: var(--color-bg-secondary);
		stroke: var(--color-text-muted);
	}
</style>
