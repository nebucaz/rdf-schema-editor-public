<script lang="ts">
	/** STORY-132: dedicated `/validation` route — thin wrapper around `ValidationReportView`,
	 *  mirroring `/identities/+page.svelte`'s route-file-is-the-page structure. */
	import ValidationAbout from '#lib/components/ValidationAbout.svelte';
	import ValidationReportView from '#lib/components/ValidationReportView.svelte';
	import { page } from '$app/state';
	import { appUrl } from '#lib/utils/urls.js';

</script>

<svelte:head>
	<title>Validation Report — RDF Schema Editor</title>
</svelte:head>

<div class="validation-page">
	<h1 class="no-print">Validation Report</h1>
	<p class="see-also no-print">
		<a href={appUrl('/questions#results')} data-testid="cq-results-link">Competency question results</a>
		show whether the model still answers the agreed questions.
	</p>
	<ValidationAbout />
	<ValidationReportView findingParam={page.url.searchParams.get('finding')} />
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

	.see-also {
		margin: 0;
		font-size: 0.9rem;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}

	@media print {
		.no-print {
			display: none !important;
		}
		.validation-page {
			height: auto;
			padding: 0;
			overflow: visible;
		}
		:global(body:has(.validation-page) .app-header) {
			display: none;
		}
		:global(body:has(.validation-page) .app-main) {
			overflow: visible;
			height: auto;
		}
	}
</style>
