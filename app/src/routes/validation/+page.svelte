<script lang="ts">
	/** STORY-132: dedicated `/validation` route — thin wrapper around `ValidationReportView`,
	 *  mirroring `/identities/+page.svelte`'s route-file-is-the-page structure. */
	import GateReportView from '#lib/components/GateReportView.svelte';
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
	<h1>Validation Report</h1>
	<p class="see-also">
		<a href={appUrl('/questions#results')} data-testid="cq-results-link">Competency question results</a>
		show whether the model still answers the agreed questions.
	</p>
	<div class="tabs" role="tablist" aria-label="Validation reports">
		<button type="button" role="tab" aria-selected={tab === 'shacl'} class:active={tab === 'shacl'} onclick={() => (tab = 'shacl')}>
			SHACL validation
		</button>
		<button type="button" role="tab" aria-selected={tab === 'gates'} class:active={tab === 'gates'} onclick={() => (tab = 'gates')} data-testid="gate-report-tab">
			Gate report
		</button>
	</div>
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
</style>
