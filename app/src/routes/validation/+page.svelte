<script lang="ts">
	/** STORY-132: dedicated `/validation` route — thin wrapper around `ValidationReportView`,
	 *  mirroring `/identities/+page.svelte`'s route-file-is-the-page structure. */
	import GateReportView from '#lib/components/GateReportView.svelte';
	import ValidationAbout from '#lib/components/ValidationAbout.svelte';
	import ValidationReportView from '#lib/components/ValidationReportView.svelte';
	import { page } from '$app/state';
	import { appUrl } from '#lib/utils/urls.js';

	// `?tab=gates` opens the Gate report directly (linked from the Pipeline view).
	let tab = $state<'shacl' | 'gates'>(page.url.searchParams.get('tab') === 'gates' ? 'gates' : 'shacl');
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
	<div class="tabs no-print" role="tablist" aria-label="Validation reports">
		<button type="button" role="tab" aria-selected={tab === 'shacl'} class:active={tab === 'shacl'} onclick={() => (tab = 'shacl')}>
			SHACL validation
		</button>
		<button type="button" role="tab" aria-selected={tab === 'gates'} class:active={tab === 'gates'} onclick={() => (tab = 'gates')} data-testid="gate-report-tab">
			Gate report
		</button>
	</div>
	<ValidationAbout {tab} />
	{#if tab === 'shacl'}
		<ValidationReportView />
	{:else}
		<GateReportView />
	{/if}
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

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.tabs button {
		padding: 0.4rem 0.8rem;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--color-text);
		font: inherit;
		cursor: pointer;
	}

	.tabs button.active {
		border-bottom-color: var(--color-text);
		font-weight: 600;
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
