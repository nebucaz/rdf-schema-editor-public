<script lang="ts">
	/** The concepts one hop from the selected concept (vocabulary-graph-and-tabs STORY-454): broader above, narrower
	 *  below, related at the side. Read-only; clicking a neighbour only reports it. Hidden when the concept has no
	 *  relations. */
	import { buildNeighborhood, type NeighborRef } from '#lib/services/concept-graph.js';
	import type { Concept } from '#lib/services/skos-concept.js';

	interface Props {
		concepts: Concept[];
		iri: string;
		onSelect: (iri: string) => void;
	}

	let { concepts, iri, onSelect }: Props = $props();

	const MAX_PER_GROUP = 12;
	const W = 118;
	const H = 28;
	const GAP = 10;
	const ROW = 80;
	const SIDE_GAP = 40;

	type Kind = 'broader' | 'narrower' | 'related';
	interface Placed extends NeighborRef {
		kind: Kind;
		x: number;
		y: number;
	}

	const hood = $derived(buildNeighborhood(concepts, iri));
	const hasRelations = $derived(hood.broader.length + hood.narrower.length + hood.related.length > 0);

	const layout = $derived.by(() => {
		const rows = Math.max(1, Math.min(MAX_PER_GROUP, Math.max(hood.broader.length, hood.narrower.length)));
		const mainWidth = rows * (W + GAP) - GAP;
		const sideX = mainWidth + SIDE_GAP + W / 2;
		const width = hood.related.length ? mainWidth + SIDE_GAP + W : mainWidth;
		const centerX = mainWidth / 2;
		const row = (list: NeighborRef[], kind: Kind, y: number): Placed[] => {
			const shown = list.slice(0, MAX_PER_GROUP);
			const span = shown.length * (W + GAP) - GAP;
			return shown.map((n, i) => ({ ...n, kind, x: centerX - span / 2 + W / 2 + i * (W + GAP), y }));
		};
		const related: Placed[] = hood.related.slice(0, MAX_PER_GROUP).map((n, i) => ({ ...n, kind: 'related', x: sideX, y: ROW + i * (H + GAP) }));
		const placed = [...row(hood.broader, 'broader', 0), ...row(hood.narrower, 'narrower', 2 * ROW), ...related];
		const height = Math.max(2 * ROW, ROW + related.length * (H + GAP)) + H;
		return { width, height, centerX, placed };
	});

	const hidden = (list: NeighborRef[]) => Math.max(0, list.length - MAX_PER_GROUP);

	function onKey(event: KeyboardEvent, target: string) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onSelect(target);
		}
	}
</script>

{#if hood.center && hasRelations}
	<details class="neighborhood" open>
		<summary>Neighbourhood</summary>
		<svg
			role="group"
			aria-label="Neighbourhood of {hood.center.label}"
			viewBox="{-W / 2} {-H} {layout.width + W} {layout.height + H}"
			style="max-width: {layout.width + W}px"
		>
			{#each layout.placed as n (n.kind + n.iri)}
				<line
					class="edge {n.kind}"
					x1={layout.centerX}
					y1={ROW}
					x2={n.x}
					y2={n.y}
				/>
			{/each}
			<g class="center" transform="translate({layout.centerX}, {ROW})">
				<rect x={-W / 2} y={-H / 2} width={W} height={H} rx="6" />
				<text text-anchor="middle" dy="0.35em">{hood.center.label.length > 18 ? `${hood.center.label.slice(0, 17)}…` : hood.center.label}</text>
			</g>
			{#each layout.placed as n (n.kind + n.iri)}
				<g
					class="neighbor {n.kind}"
					transform="translate({n.x}, {n.y})"
					role="button"
					tabindex="0"
					aria-label="Select {n.label} ({n.kind})"
					onclick={() => onSelect(n.iri)}
					onkeydown={(e) => onKey(e, n.iri)}
				>
					<rect x={-W / 2} y={-H / 2} width={W} height={H} rx="6" />
					<text text-anchor="middle" dy="0.35em">{n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}</text>
					<title>{n.label}</title>
				</g>
			{/each}
		</svg>
		{#if hidden(hood.broader) + hidden(hood.narrower) + hidden(hood.related) > 0}
			<p class="more">Showing the first {MAX_PER_GROUP} of each group.</p>
		{/if}
	</details>
{/if}

<style>
	.neighborhood {
		margin: 0.75rem 0;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
	}
	svg {
		width: 100%;
		height: auto;
		margin-top: 0.5rem;
	}
	.edge {
		stroke: var(--graph-link-broader);
		stroke-width: 1.5;
	}
	.edge.related {
		stroke: var(--graph-link-related);
		stroke-dasharray: 6 4;
	}
	rect {
		fill: var(--graph-node-fill);
		stroke: var(--color-accent);
		stroke-width: 1.5;
	}
	.center rect {
		fill: var(--color-accent);
	}
	.center text {
		fill: #fff;
	}
	text {
		font-size: 12px;
		fill: var(--color-text);
		pointer-events: none;
	}
	.neighbor {
		cursor: pointer;
	}
	.neighbor.related rect {
		stroke: var(--graph-link-related);
	}
	.neighbor:focus-visible rect {
		stroke-width: 3;
	}
	.more {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
</style>
