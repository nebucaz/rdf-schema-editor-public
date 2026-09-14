<script lang="ts">
	/** STORY-132: dedicated `/validation` route — thin wrapper around `ValidationReportView`,
	 *  mirroring `/identities/+page.svelte`'s route-file-is-the-page structure. */
	import ValidationReportView from '$lib/components/ValidationReportView.svelte';
</script>

<svelte:head>
	<title>Validation Report — RDF Schema Editor</title>
</svelte:head>

<div class="validation-page">
	<h1>Validation Report</h1>
	<ValidationReportView />
</div>

<style>
	.validation-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
</style>
