<script lang="ts">
	import DescriptionVisibilityToggle from '#lib/components/DescriptionVisibilityToggle.svelte';
	import InheritedAttributesVisibilityToggle from '#lib/components/InheritedAttributesVisibilityToggle.svelte';
	import ReverseRelationsVisibilityToggle from '#lib/components/ReverseRelationsVisibilityToggle.svelte';
	import ConceptBadgeToggle from '#lib/components/ConceptBadgeToggle.svelte';

	interface Props {
		/** The "no concept" badge only makes sense when a vocabulary namespace exists. */
		showConceptBadge: boolean;
	}

	let { showConceptBadge }: Props = $props();
</script>

<div class="view-toggles">
	<DescriptionVisibilityToggle />
	<InheritedAttributesVisibilityToggle />
	<ReverseRelationsVisibilityToggle />
	{#if showConceptBadge}
		<ConceptBadgeToggle />
	{/if}
</div>

<style>
	.view-toggles {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
