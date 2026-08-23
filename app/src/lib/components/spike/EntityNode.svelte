<script lang="ts">
	import { Handle, Position, type NodeProps, type Node } from '@xyflow/svelte';

	type EntityNodeData = { label: string; attributes: string[] };
	type EntityNode = Node<EntityNodeData, 'entity'>;

	let { data }: NodeProps<EntityNode> = $props();
</script>

<div class="entity-node">
	<Handle type="target" position={Position.Left} id="in" />
	<div class="header">{data.label}</div>
	<ul class="attributes">
		{#each data.attributes as attribute (attribute)}
			<li>{attribute}</li>
		{/each}
	</ul>
	<Handle type="source" position={Position.Right} id="out" />
</div>

<style>
	.entity-node {
		min-width: 160px;
		border: 1px solid var(--color-border, #888);
		border-radius: 6px;
		background: var(--color-bg-secondary, #fff);
		font-size: 12px;
		overflow: hidden;
	}

	.header {
		background: var(--color-accent, #007acc);
		color: #fff;
		font-weight: 600;
		padding: 6px 10px;
	}

	.attributes {
		list-style: none;
		margin: 0;
		padding: 4px 10px;
	}

	.attributes li {
		padding: 2px 0;
		border-top: 1px solid var(--color-border, #eee);
	}

	.attributes li:first-child {
		border-top: none;
	}
</style>
