<script lang="ts">
	import { conceptBadgeVisibilityStore } from '#lib/stores/concept-badge-visibility-store.svelte.js';

	const show = $derived(conceptBadgeVisibilityStore.getShowConceptBadge());
</script>

<button
	class="concept-badge-toggle"
	onclick={() => conceptBadgeVisibilityStore.setShowConceptBadge(!show)}
	aria-label="Toggle badge for classes without a concept"
	aria-pressed={show}
	title={show ? 'Hide the “no concept” badge' : 'Show a “no concept” badge on classes without a vocabulary concept'}
>
	<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
		{#if !show}<path d="m3 3 18 18" />{/if}
	</svg>
</button>

<style>
	.concept-badge-toggle {
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

	.concept-badge-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}
</style>
