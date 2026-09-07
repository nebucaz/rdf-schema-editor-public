<script lang="ts">
	import { inheritedAttributesVisibilityStore } from '$lib/stores/inherited-attributes-visibility-store.svelte';

	const showInheritedAttributes = $derived(inheritedAttributesVisibilityStore.getShowInheritedAttributes());
</script>

<button
	class="inherited-attributes-visibility-toggle"
	onclick={() => inheritedAttributesVisibilityStore.setShowInheritedAttributes(!showInheritedAttributes)}
	aria-label="Toggle inherited attributes visibility"
	aria-pressed={showInheritedAttributes}
	title={showInheritedAttributes ? 'Hide inherited attributes' : 'Show inherited attributes'}
>
	{#if showInheritedAttributes}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
			<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/>
			<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>
		</svg>
	{:else}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>
			<path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/>
			<path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>
			<path d="m2 2 20 20"/>
		</svg>
	{/if}
</button>

<style>
	.inherited-attributes-visibility-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		min-height: 36px;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		cursor: pointer;
		transition: background var(--transition), border-color var(--transition);
	}

	.inherited-attributes-visibility-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}
</style>
