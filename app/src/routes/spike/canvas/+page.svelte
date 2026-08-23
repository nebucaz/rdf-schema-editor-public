<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		BackgroundVariant,
		MarkerType,
		type Node,
		type Edge,
		type Connection
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import EntityNode from '$lib/components/spike/EntityNode.svelte';
	import AttributedEdge from '$lib/components/spike/AttributedEdge.svelte';

	const NODE_COUNT = 30;
	const COLS = 6;

	function initialNodes(): Node[] {
		return Array.from({ length: NODE_COUNT }, (_, i) => ({
			id: `n${i}`,
			type: 'entity',
			position: { x: (i % COLS) * 220, y: Math.floor(i / COLS) * 160 },
			data: {
				label: `Entity${i}`,
				attributes: ['id : xsd:string', 'name : xsd:string']
			}
		}));
	}

	function initialEdges(): Edge[] {
		return Array.from({ length: NODE_COUNT - 1 }, (_, i) => ({
			id: `e-n${i}-n${i + 1}`,
			source: `n${i}`,
			target: `n${i + 1}`,
			sourceHandle: 'out',
			targetHandle: 'in',
			type: i % 3 === 0 ? 'attributed' : 'default',
			markerEnd: { type: MarkerType.ArrowClosed }
		}));
	}

	let nodes = $state.raw<Node[]>(initialNodes());
	let edges = $state.raw<Edge[]>(initialEdges());

	const nodeTypes = { entity: EntityNode };
	const edgeTypes = { attributed: AttributedEdge };

	function handleConnect(connection: Connection) {
		edges = [
			...edges,
			{
				id: `e-${connection.source}-${connection.target}-${crypto.randomUUID()}`,
				source: connection.source,
				target: connection.target,
				sourceHandle: connection.sourceHandle,
				targetHandle: connection.targetHandle,
				type: 'attributed',
				markerEnd: { type: MarkerType.ArrowClosed }
			}
		];
	}
</script>

<div class="spike-page">
	<div class="canvas-wrap">
		<SvelteFlow bind:nodes bind:edges {nodeTypes} {edgeTypes} onconnect={handleConnect} fitView>
			<Background variant={BackgroundVariant.Dots} />
			<Controls />
			<MiniMap />
		</SvelteFlow>
	</div>
	<aside class="inspector">
		<h2>Edges ({edges.length})</h2>
		<p class="hint">Drag from an entity's right handle to another entity's left handle to create a
			new attributed-relationship edge — it will appear in this list.</p>
		<ul>
			{#each edges as edge (edge.id)}
				<li><code>{edge.source}</code> &rarr; <code>{edge.target}</code> <span class="edge-type">({edge.type})</span></li>
			{/each}
		</ul>
	</aside>
</div>

<style>
	.spike-page {
		display: flex;
		height: 100%;
		width: 100%;
	}

	.canvas-wrap {
		flex: 1;
		position: relative;
	}

	.inspector {
		width: 280px;
		border-left: 1px solid var(--color-border, #e0e0e0);
		padding: 1rem;
		overflow-y: auto;
	}

	.inspector h2 {
		font-size: 14px;
		margin-bottom: 0.5rem;
	}

	.hint {
		font-size: 12px;
		color: var(--color-text-muted, #666);
		margin-bottom: 0.75rem;
	}

	.inspector ul {
		list-style: none;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.edge-type {
		color: var(--color-text-muted, #666);
	}
</style>
