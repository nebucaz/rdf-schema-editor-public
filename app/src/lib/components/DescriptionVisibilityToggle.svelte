<script lang="ts">
	import { descriptionVisibilityStore } from '$lib/stores/description-visibility-store.svelte';

	const showDescriptions = $derived(descriptionVisibilityStore.getShowDescriptions());
</script>

<button
	class="description-visibility-toggle"
	onclick={() => descriptionVisibilityStore.setShowDescriptions(!showDescriptions)}
	aria-label="Toggle description visibility"
	aria-pressed={showDescriptions}
	title={showDescriptions ? 'Hide descriptions' : 'Show descriptions'}
>
	{#if showDescriptions}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>
			<circle cx="12" cy="12" r="3"/>
		</svg>
	{:else}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>
			<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>
			<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>
			<path d="m2 2 20 20"/>
		</svg>
	{/if}
</button>

<style>
	.description-visibility-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		cursor: pointer;
		transition: background var(--transition), border-color var(--transition);
	}

	.description-visibility-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}
</style>
