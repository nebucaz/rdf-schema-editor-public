<script lang="ts">
	import type { FetchedNamespace } from '$lib/services/sparql-connector';

	interface Props {
		/** Every registered namespace (STORY-027's `fetchNamespaces()`), listed regardless of
		 *  whether the canvas currently holds any of its entries. */
		namespaces: FetchedNamespace[];
		/** Base IRIs of namespaces currently hidden from the canvas — a client-side view filter
		 *  only (STORY-033, Decision 6); toggling never re-queries GraphDB. */
		hiddenNamespaces: Set<string>;
		onToggle: (baseIri: string) => void;
	}

	let { namespaces, hiddenNamespaces, onToggle }: Props = $props();

	let isOpen = $state(false);

	function toggleOpen() {
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		}
	}
</script>

<svelte:window onkeydown={isOpen ? handleKeydown : undefined} />

<div class="namespace-filter-wrapper">
	<button
		type="button"
		class="filter-toggle"
		onclick={toggleOpen}
		aria-haspopup="true"
		aria-expanded={isOpen}
		title="Filter namespaces"
	>
		Filter Namespaces{hiddenNamespaces.size > 0 ? ` (${hiddenNamespaces.size} hidden)` : ''}
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="filter-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="presentation" tabindex="-1"></div>
		<div class="filter-panel" role="menu" tabindex="-1">
			{#if namespaces.length === 0}
				<p class="filter-empty">No namespaces registered.</p>
			{/if}
			{#each namespaces as ns (ns.baseIri)}
				<label class="filter-row">
					<input type="checkbox" checked={!hiddenNamespaces.has(ns.baseIri)} onchange={() => onToggle(ns.baseIri)} />
					<span>{ns.prefix}</span>
				</label>
			{/each}
		</div>
	{/if}
</div>

<style>
	.namespace-filter-wrapper {
		position: relative;
	}

	.filter-toggle {
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
		font-size: 0.85rem;
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--transition), border-color var(--transition);
	}

	.filter-toggle:hover {
		background: var(--color-hover);
	}

	.filter-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: transparent;
		z-index: 1000;
	}

	.filter-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		left: 0;
		min-width: 180px;
		max-height: 320px;
		overflow-y: auto;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1001;
	}

	.filter-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 6px;
		font-size: 0.85rem;
		color: var(--color-text);
		cursor: pointer;
	}

	.filter-row:hover {
		background: var(--color-hover);
	}

	.filter-empty {
		margin: 0;
		padding: 0.35rem 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
</style>
