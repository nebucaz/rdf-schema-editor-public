<script lang="ts">
	/**
	 * STORY-120: on-demand, ephemeral neighborhood graph, ported from `semantic-crm`'s
	 * `GraphCanvas.svelte` (plain `d3-force`, no Svelte Flow/vis-network/Cytoscape.js/Sigma.js).
	 * Seeded with one identity's 1-hop neighborhood on mount (`fetchIdentityNeighborhood`,
	 * STORY-117). Interaction mapping is the reverse of the ported original: a single click opens a
	 * `ViewNodePanel`-style read-only side panel for that node (`fetchResourcePage`, STORY-116) —
	 * this app's actual "more information about this node" affordance — while a double-click expands
	 * that node's own 1-hop neighborhood into the current set (`mergeNeighborhood`, ported from the
	 * original's `handleNodeExpand`). Swapped deliberately from the original's click=expand/
	 * dblclick=view-panel pairing once a first pass shipped the original mapping and turned out to
	 * surprise users — a click "popping" new nodes onto the canvas read as noise when what was
	 * expected was detail about the node just clicked. The side panel's "View full page" button
	 * still reaches STORY-119's full resource page. The shift-click/long-press "add triple"
	 * affordance is dropped entirely — out of scope per the read-only v1 decision. Node positions,
	 * the expanded set, and the side panel selection are ordinary component state, never persisted —
	 * every mount (i.e. every time this component is opened) starts fresh from just the seed's own
	 * neighborhood.
	 */
	import { onMount } from 'svelte';
	import * as d3 from 'd3';
	import {
		sparqlConnector,
		type NeighborhoodGraph,
		type NeighborhoodNode,
		type NeighborhoodLink,
		type ResourcePage
	} from '$lib/services/sparql-connector';
	import { mergeNeighborhood } from '$lib/utils/neighborhood-merge';
	import {
		deriveResourceHeader,
		displayLabel,
		formatLiteralValue,
		labelOrPrettify,
		splitOutgoingTriples
	} from '$lib/utils/resource-page-format';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { buildClassHierarchyIndex, resolveNodeColor, type ClassHierarchyIndex } from '$lib/utils/namespace-color';
	import { contrastTextColor } from '$lib/utils/contrast';

	interface IdentityRef {
		iri: string;
		label: string;
	}

	interface Props {
		seedIri: string;
		onNavigate: (ref: IdentityRef) => void;
	}

	let { seedIri, onNavigate }: Props = $props();

	let graph = $state<NeighborhoodGraph>({ nodes: [], links: [] });
	let isLoading = $state(true);
	let isExpanding = $state(false);
	let error = $state<string | null>(null);

	// Namespace-default node coloring (STORY-120 follow-up): loaded once alongside the seed
	// neighborhood, independent of `graph`'s own loading state — a class hierarchy fetch failure
	// shouldn't block the graph itself, nodes just render with the static accent-color fallback.
	let classHierarchyIndex = $state<ClassHierarchyIndex>({ classNamespaceByIri: new Map(), parentsByClassIri: new Map() });
	let namespaceColorByBaseIri = $state<Map<string, string>>(new Map());

	// The side panel opened by a single click (STORY-120 revision) — set to a node's ref immediately
	// on click, which the effect below resolves into `panelPage` via `fetchResourcePage`.
	let panelNode = $state<IdentityRef | null>(null);
	let panelPage = $state<ResourcePage | null>(null);
	let panelLoading = $state(false);
	let panelError = $state<string | null>(null);

	let canvasContainer: HTMLDivElement;
	let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
	let simulation: d3.Simulation<NodeDatum, LinkDatum>;

	// Single-click (open side panel) vs double-click (expand): delay the single-click action so a
	// dblclick can cancel it before it fires — same delay technique as the ported original, just
	// applied to the opposite action per the swapped mapping above.
	let clickTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let hasDragged = false;

	const NODE_HEIGHT = 36;
	const NODE_MIN_WIDTH = 72;
	const NODE_PADDING_X = 24;
	const NODE_CHAR_WIDTH = 7;

	interface NodeDatum extends d3.SimulationNodeDatum {
		iri: string;
		label: string;
		width: number;
		height: number;
		/** Resolved namespace-default color (`resolveNodeColor`) — `undefined` falls back to the
		 *  static theme accent, same as every other node kind in this app with no color of its own. */
		color: string | undefined;
	}

	interface LinkDatum extends d3.SimulationLinkDatum<NodeDatum> {
		predicateIri: string;
		predicateLabel: string;
	}

	onMount(() => {
		initCanvas();
		void loadSeed();
		void loadColorIndex();
		return () => {
			if (simulation) simulation.stop();
		};
	});

	async function loadColorIndex() {
		try {
			await namespaceStore.ensureLoaded();
			const schema = await sparqlConnector.fetchFullSchemaForAllNamespaces();
			classHierarchyIndex = buildClassHierarchyIndex(schema.classes, schema.subClassOf);
			namespaceColorByBaseIri = new Map(
				namespaceStore.namespaces.filter((ns) => ns.color).map((ns) => [ns.baseIri, ns.color as string])
			);
		} catch {
			// Coloring is a purely cosmetic enhancement — leave every node on the static fallback
			// color rather than surfacing this as a graph-loading error.
		}
	}

	async function loadSeed() {
		isLoading = true;
		error = null;
		try {
			graph = await sparqlConnector.fetchIdentityNeighborhood([seedIri], 1);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load neighborhood';
		} finally {
			isLoading = false;
		}
	}

	async function handleNodeExpand(node: IdentityRef) {
		isExpanding = true;
		try {
			const delta = await sparqlConnector.fetchIdentityNeighborhood([node.iri], 1);
			graph = mergeNeighborhood(graph, delta);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to expand neighborhood';
		} finally {
			isExpanding = false;
		}
	}

	function openPanel(node: IdentityRef) {
		panelNode = { iri: node.iri, label: node.label };
	}

	function closePanel() {
		panelNode = null;
	}

	$effect(() => {
		const target = panelNode;
		if (!target) {
			panelPage = null;
			panelError = null;
			return;
		}
		let cancelled = false;
		panelLoading = true;
		panelError = null;
		panelPage = null;

		sparqlConnector
			.fetchResourcePage(target.iri)
			.then((result) => {
				if (cancelled) return;
				panelPage = result;
				panelLoading = false;
			})
			.catch((err) => {
				if (cancelled) return;
				panelError = err instanceof Error ? err.message : 'Failed to load identity';
				panelLoading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	const panelHeader = $derived(panelPage && panelNode ? deriveResourceHeader(panelNode.iri, panelPage.outgoing) : null);
	const panelSplit = $derived(panelPage ? splitOutgoingTriples(panelPage.outgoing) : null);

	function initCanvas() {
		const width = canvasContainer.clientWidth;
		const height = canvasContainer.clientHeight;

		svg = d3
			.select(canvasContainer)
			.append('svg')
			.attr('width', '100%')
			.attr('height', '100%')
			.attr('viewBox', `0 0 ${width} ${height}`);

		const defs = svg.append('defs');
		defs
			.append('marker')
			.attr('id', 'neighborhood-arrowhead')
			.attr('viewBox', '0 -5 10 10')
			.attr('refX', 10)
			.attr('refY', 0)
			.attr('orient', 'auto')
			.attr('markerWidth', 8)
			.attr('markerHeight', 8)
			.append('path')
			.attr('d', 'M 0,-4 L 10,0 L 0,4 Z')
			.attr('class', 'arrowhead');

		svg.append('g').attr('class', 'canvas-group');

		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.filter((event) => {
				if (event.sourceEvent?.type === 'dblclick') {
					const target = event.sourceEvent.target as Element;
					return !target.closest?.('.node');
				}
				return true;
			})
			.on('zoom', (event) => {
				svg.select('.canvas-group').attr('transform', event.transform);
			});

		svg.call(zoom);
	}

	/** Point on the boundary of a `2*halfW x 2*halfH` rectangle centered at the origin, in the
	 *  direction of `(dx, dy)` — used to shorten link lines/arrowheads to each node's rounded-
	 *  rectangle edge instead of its center, since nodes are no longer uniform circles. */
	function rectBoundaryOffset(dx: number, dy: number, halfW: number, halfH: number): { x: number; y: number } {
		if (dx === 0 && dy === 0) return { x: 0, y: 0 };
		const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
		return { x: dx * scale, y: dy * scale };
	}

	function nodeWidth(label: string): number {
		const truncated = truncateLabel(label, 16);
		return Math.max(NODE_MIN_WIDTH, truncated.length * NODE_CHAR_WIDTH + NODE_PADDING_X);
	}

	function renderGraph(nodeData: NodeDatum[], linkData: LinkDatum[]) {
		if (!svg) return;

		const width = canvasContainer.clientWidth;
		const height = canvasContainer.clientHeight;
		const group = svg.select<SVGGElement>('.canvas-group');
		group.selectAll('*').remove();

		if (nodeData.length === 0) return;

		const nodeMap = new Map<string, NodeDatum>();
		nodeData.forEach((n) => nodeMap.set(n.iri, n));

		const processedLinks: LinkDatum[] = linkData
			.filter((l) => nodeMap.has(l.source as string) && nodeMap.has(l.target as string))
			.map((l) => ({
				...l,
				source: nodeMap.get(l.source as string)!,
				target: nodeMap.get(l.target as string)!
			}));

		simulation = d3
			.forceSimulation<NodeDatum>(nodeData)
			.force(
				'link',
				d3
					.forceLink<NodeDatum, LinkDatum>(processedLinks)
					.id((d) => d.iri)
					.distance(150)
			)
			.force('charge', d3.forceManyBody().strength(-300))
			.force('center', d3.forceCenter(width / 2, height / 2))
			.force(
				'collision',
				d3.forceCollide<NodeDatum>().radius((d) => Math.max(d.width, d.height) / 2 + 8)
			);

		const linkGroup = group.append('g').attr('class', 'links');
		const linkLines = linkGroup
			.selectAll<SVGLineElement, LinkDatum>('.link')
			.data(processedLinks)
			.join('line')
			.attr('class', 'link')
			.attr('marker-end', 'url(#neighborhood-arrowhead)');

		const linkLabels = linkGroup
			.selectAll<SVGTextElement, LinkDatum>('.link-label')
			.data(processedLinks)
			.join('text')
			.attr('class', 'link-label')
			.text((d) => d.predicateLabel);

		if (clickTimeoutId != null) {
			clearTimeout(clickTimeoutId);
			clickTimeoutId = null;
		}

		const nodeGroups = group
			.selectAll<SVGGElement, NodeDatum>('.node')
			.data(nodeData)
			.join('g')
			.attr('class', 'node')
			.call(d3.drag<SVGGElement, NodeDatum>().on('start', dragStarted).on('drag', dragged).on('end', dragEnded));

		nodeGroups.on('dblclick', function (event: MouseEvent, d: NodeDatum) {
			event.preventDefault();
			if (clickTimeoutId != null) {
				clearTimeout(clickTimeoutId);
				clickTimeoutId = null;
			}
			void handleNodeExpand({ iri: d.iri, label: d.label });
		});

		nodeGroups
			.append('rect')
			.attr('class', 'node-rect')
			.attr('x', (d) => -d.width / 2)
			.attr('y', (d) => -d.height / 2)
			.attr('width', (d) => d.width)
			.attr('height', (d) => d.height)
			.attr('rx', 10)
			.attr('ry', 10)
			.style('cursor', 'pointer')
			.style('fill', (d) => d.color ?? 'var(--color-accent)');

		nodeGroups
			.append('text')
			.text((d) => truncateLabel(d.label, 16))
			.attr('text-anchor', 'middle')
			.attr('dy', '0.35em')
			.attr('class', 'node-label')
			.attr('pointer-events', 'none')
			.style('fill', (d) => (d.color ? contrastTextColor(d.color) : null));

		nodeGroups.append('title').text((d) => `${d.label}\n${d.iri}`);

		simulation.on('tick', () => {
			linkLines.each(function (d) {
				const source = d.source as NodeDatum;
				const target = d.target as NodeDatum;
				const dx = target.x! - source.x!;
				const dy = target.y! - source.y!;
				const sourceOffset = rectBoundaryOffset(dx, dy, source.width / 2, source.height / 2);
				const targetOffset = rectBoundaryOffset(-dx, -dy, target.width / 2, target.height / 2);

				d3.select(this)
					.attr('x1', source.x! + sourceOffset.x)
					.attr('y1', source.y! + sourceOffset.y)
					.attr('x2', target.x! + targetOffset.x)
					.attr('y2', target.y! + targetOffset.y);
			});

			linkLabels
				.attr('x', (d) => ((d.source as NodeDatum).x! + (d.target as NodeDatum).x!) / 2)
				.attr('y', (d) => ((d.source as NodeDatum).y! + (d.target as NodeDatum).y!) / 2);

			nodeGroups.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
		});

		function dragStarted(event: d3.D3DragEvent<SVGGElement, NodeDatum, NodeDatum>) {
			hasDragged = false;
			if (!event.active) simulation.alphaTarget(0.3).restart();
			event.subject.fx = event.subject.x;
			event.subject.fy = event.subject.y;
		}

		function dragged(event: d3.D3DragEvent<SVGGElement, NodeDatum, NodeDatum>) {
			hasDragged = true;
			event.subject.fx = event.x;
			event.subject.fy = event.y;
		}

		function dragEnded(event: d3.D3DragEvent<SVGGElement, NodeDatum, NodeDatum>) {
			if (!event.active) simulation.alphaTarget(0);
			event.subject.fx = null;
			event.subject.fy = null;

			const d = event.subject;
			if (!hasDragged) {
				// Single click: schedule the side-panel open; dblclick above cancels this.
				if (clickTimeoutId != null) clearTimeout(clickTimeoutId);
				clickTimeoutId = setTimeout(() => {
					clickTimeoutId = null;
					openPanel({ iri: d.iri, label: d.label });
				}, 250);
			}
		}
	}

	function truncateLabel(label: string, maxLength: number): string {
		if (label.length <= maxLength) return label;
		return label.substring(0, maxLength - 1) + '…';
	}

	$effect(() => {
		const nodeData: NodeDatum[] = graph.nodes.map((n: NeighborhoodNode) => ({
			iri: n.iri,
			label: n.label,
			width: nodeWidth(n.label),
			height: NODE_HEIGHT,
			color: resolveNodeColor(n, classHierarchyIndex, namespaceColorByBaseIri)
		}));
		const linkData: LinkDatum[] = graph.links.map((l: NeighborhoodLink) => ({
			source: l.source,
			target: l.target,
			predicateIri: l.predicateIri,
			predicateLabel: l.predicateLabel
		}));
		renderGraph(nodeData, linkData);
	});
</script>

<div class="identity-neighborhood-graph">
	{#if isLoading}
		<div class="status-overlay"><p>Loading neighborhood…</p></div>
	{:else if error}
		<div class="status-overlay"><p class="error">{error}</p></div>
	{:else if graph.nodes.length === 0}
		<div class="status-overlay"><p>This identity has no connections to explore.</p></div>
	{/if}
	{#if isExpanding}
		<div class="expanding-indicator">Expanding…</div>
	{/if}
	<div class="canvas-container" bind:this={canvasContainer}></div>

	{#if panelNode}
		<aside class="side-panel" aria-label="Node properties">
			<div class="side-panel-header">
				<h3 class="side-panel-title">{panelHeader?.label ?? panelNode.label}</h3>
				<button type="button" class="side-panel-close" onclick={closePanel} aria-label="Close panel">×</button>
			</div>
			<div class="side-panel-body">
				{#if panelLoading}
					<p class="muted">Loading…</p>
				{:else if panelError}
					<p class="error">{panelError}</p>
				{:else if panelHeader && panelSplit}
					{#if panelHeader.typeIris.length > 0}
						<p class="types">
							{#each panelHeader.typeIris as typeIri, i (typeIri)}
								{#if i > 0}<span aria-hidden="true">, </span>{/if}
								<span class="type-badge">{labelOrPrettify(undefined, typeIri)}</span>
							{/each}
						</p>
					{/if}
					<code class="panel-iri">{panelNode.iri}</code>

					<h4>Properties</h4>
					{#if panelSplit.literalTriples.length === 0}
						<p class="muted">No properties.</p>
					{:else}
						<dl class="triple-list">
							{#each panelSplit.literalTriples as t (t.predicateIri + t.object)}
								<dt>{displayLabel(t.predicateLabel)}</dt>
								<dd>{formatLiteralValue(t.object, t.objectDatatype)}</dd>
							{/each}
						</dl>
					{/if}

					<h4>Outgoing</h4>
					{#if panelSplit.uriTriples.length === 0}
						<p class="muted">No outgoing connections.</p>
					{:else}
						<dl class="triple-list">
							{#each panelSplit.uriTriples as t (t.predicateIri + t.object)}
								<dt>{displayLabel(t.predicateLabel)}</dt>
								<dd>{labelOrPrettify(t.objectLabel, t.object)}</dd>
							{/each}
						</dl>
					{/if}

					<h4>Incoming</h4>
					{#if panelPage && panelPage.incoming.length === 0}
						<p class="muted">Nothing links here.</p>
					{:else if panelPage}
						<dl class="triple-list">
							{#each panelPage.incoming as t (t.subjectIri + t.predicateIri)}
								<dt>{displayLabel(t.predicateLabel)}</dt>
								<dd>{displayLabel(t.subjectLabel)}</dd>
							{/each}
						</dl>
					{/if}
				{/if}
			</div>
			<div class="side-panel-footer">
				<button type="button" class="view-full-btn" onclick={() => onNavigate(panelNode!)}>
					View full page →
				</button>
			</div>
		</aside>
	{/if}
</div>

<style>
	.identity-neighborhood-graph {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.canvas-container {
		width: 100%;
		height: 100%;
		background: var(--color-bg-secondary);
		border-radius: 8px;
		position: relative;
		overflow: hidden;
	}

	.canvas-container :global(svg) {
		display: block;
	}

	.canvas-container :global(.node-rect) {
		/* fill is set per-node via d3 (inline style), from the namespace-default color resolution —
		   an inline style always wins over this class rule, so no fallback `fill` is declared here. */
		stroke: var(--color-bg-secondary);
		stroke-width: 2px;
		transition: filter 0.15s ease;
	}

	.canvas-container :global(.node-rect:hover) {
		/* filter, not fill: an inline `style="fill: ..."` (set per-node) always wins over a stylesheet
		   rule, including :hover, so brightening via a different property is what actually shows. */
		filter: brightness(1.15);
	}

	.canvas-container :global(.node-label) {
		fill: var(--color-bg-secondary);
		font-size: 10px;
		font-family: inherit;
	}

	.canvas-container :global(.link) {
		stroke: var(--color-text-muted);
		stroke-width: 1.5px;
		stroke-opacity: 0.5;
	}

	.canvas-container :global(.link-label) {
		fill: var(--color-text-muted);
		font-size: 9px;
		font-family: inherit;
		text-anchor: middle;
		pointer-events: none;
	}

	.canvas-container :global(.arrowhead) {
		fill: var(--color-text-muted);
		fill-opacity: 0.7;
	}

	.status-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1;
		pointer-events: none;
		text-align: center;
		color: var(--color-text-muted);
	}

	.status-overlay .error {
		color: var(--color-error);
	}

	.expanding-indicator {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 2;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.78rem;
	}

	.side-panel {
		position: absolute;
		top: 0;
		right: 0;
		width: 320px;
		max-width: 90vw;
		height: 100%;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border);
		box-shadow: -4px 0 12px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		z-index: 3;
	}

	.side-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--color-border);
		flex-shrink: 0;
		gap: 0.5rem;
	}

	.side-panel-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.side-panel-close {
		background: none;
		border: none;
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
		color: var(--color-text-muted);
		padding: 0.25rem;
		flex-shrink: 0;
	}

	.side-panel-close:hover {
		color: var(--color-text);
	}

	.side-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.side-panel-body h4 {
		margin: 1rem 0 0.4rem;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.side-panel-body h4:first-child {
		margin-top: 0;
	}

	.panel-iri {
		display: block;
		font-size: 0.72rem;
		word-break: break-all;
		color: var(--color-text-muted);
	}

	.types {
		margin: 0.4rem 0;
	}

	.type-badge {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.72rem;
	}

	.triple-list {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.75rem;
		margin: 0;
		font-size: 0.82rem;
	}

	.triple-list dt {
		margin: 0;
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.triple-list dd {
		margin: 0;
		color: var(--color-text);
		text-align: right;
	}

	.muted {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.error {
		color: var(--color-error);
	}

	.side-panel-footer {
		display: flex;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--color-border);
		flex-shrink: 0;
	}

	.view-full-btn {
		flex: 1;
		padding: 0.4rem 0.75rem;
		font-size: 0.85rem;
		border-radius: 6px;
		cursor: pointer;
		border: 1px solid var(--color-accent);
		background: transparent;
		color: var(--color-accent);
	}

	.view-full-btn:hover {
		background: var(--color-accent);
		color: var(--color-bg-secondary);
	}
</style>
