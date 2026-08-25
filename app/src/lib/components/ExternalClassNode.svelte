<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export interface ExternalClassNodeData extends Record<string, unknown> {
		/** e.g. "schema:Organization" */
		prefixedName: string;
		onRemove: () => void;
	}

	export type ExternalClassNodeType = Node<ExternalClassNodeData, 'external'>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps<ExternalClassNodeType> = $props();
</script>

<div class="stub-node" class:selected>
	<!-- Target-only handle at each side: external classes only ever receive inheritance edges
		(see EntityNode.svelte for why there's one per side instead of a single left handle). -->
	<Handle type="target" position={Position.Top} id="top-target" />
	<Handle type="target" position={Position.Right} id="right-target" />
	<Handle type="target" position={Position.Bottom} id="bottom-target" />
	<Handle type="target" position={Position.Left} id="left-target" />
	<span class="label" title="External vocabulary reference — not editable">{data.prefixedName}</span>
	<button class="remove" onclick={data.onRemove} aria-label={`Remove ${data.prefixedName} from canvas`} title="Remove from canvas">
		×
	</button>
</div>

<style>
	.stub-node {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border: 1px dashed var(--color-text-muted, #999);
		border-radius: 6px;
		background: var(--color-bg, #f5f5f5);
		font-size: 11px;
		font-style: italic;
		color: var(--color-text-muted, #666);
	}

	.stub-node.selected {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	.remove {
		width: 16px;
		height: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		border: none;
		font-size: 12px;
		line-height: 1;
	}

	.remove:hover {
		background: var(--color-hover);
	}
</style>
