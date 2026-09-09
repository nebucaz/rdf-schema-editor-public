<script lang="ts">
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';

	const showReverseRelations = $derived(workbenchActions.showReverseRelations);
</script>

<button
	class="reverse-relations-visibility-toggle"
	onclick={() => workbenchActions.toggleReverseRelationsVisibility()}
	aria-label="Toggle reverse relations visibility"
	aria-pressed={showReverseRelations}
	title={showReverseRelations ? 'Hide reverse relations' : 'Show reverse relations'}
>
	{#if showReverseRelations}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m16 3 4 4-4 4"/>
			<path d="M20 7H4"/>
			<path d="m8 21-4-4 4-4"/>
			<path d="M4 17h16"/>
		</svg>
	{:else}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m16 3 4 4-4 4"/>
			<path d="M20 7H4"/>
			<path d="m8 21-4-4 4-4"/>
			<path d="M4 17h16"/>
			<path d="m2 2 20 20"/>
		</svg>
	{/if}
</button>

<style>
	.reverse-relations-visibility-toggle {
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

	.reverse-relations-visibility-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}
</style>
