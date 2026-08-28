<script lang="ts">
	import type { ViewMode } from '$lib/stores/view-mode-store';

	interface Props {
		viewMode: ViewMode;
		onChange: (mode: ViewMode) => void;
	}

	let { viewMode, onChange }: Props = $props();
</script>

<!-- A distinct control from NamespaceFilter's funnel (data-catalog Story 007) — deliberately not
	folded into it, since "which namespaces are visible" and "schema vs instances" are two
	unrelated dimensions that compose independently. -->
<div class="view-mode-toggle" role="group" aria-label="Canvas view mode">
	<button
		type="button"
		class="segment"
		class:active={viewMode === 'schema'}
		aria-pressed={viewMode === 'schema'}
		onclick={() => onChange('schema')}
	>
		Schema
	</button>
	<button
		type="button"
		class="segment"
		class:active={viewMode === 'instances'}
		aria-pressed={viewMode === 'instances'}
		onclick={() => onChange('instances')}
	>
		Instances
	</button>
</div>

<style>
	.view-mode-toggle {
		display: flex;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.segment {
		padding: 0.4rem 0.6rem;
		font-size: 0.8rem;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		white-space: nowrap;
	}

	.segment + .segment {
		border-left: 1px solid var(--color-border);
	}

	.segment:hover {
		background: var(--color-hover);
	}

	.segment.active {
		background: var(--color-accent);
		color: #fff;
	}
</style>
