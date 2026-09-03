<script lang="ts">
	import type { WorkspaceImportSummary, WorkspaceImportBucketSummary } from '$lib/services/sparql-connector';
	import ImportResultView from './ImportResultView.svelte';

	interface Props {
		summary: WorkspaceImportSummary;
	}

	let { summary }: Props = $props();

	const buckets: { label: string; value: WorkspaceImportBucketSummary }[] = $derived([
		{ label: 'Namespace', value: summary.namespaces },
		{ label: 'Workspace', value: summary.workspaces },
		{ label: 'Membership', value: summary.memberships },
		{ label: 'Note', value: summary.notes }
	]);
</script>

<div class="workspace-import-result">
	<p class="section-label">Schema/shapes content:</p>
	<ImportResultView summary={summary.schema} />

	<p class="section-label">Workspace bundle content:</p>
	<ul class="bucket-counts">
		{#each buckets as bucket (bucket.label)}
			<li>
				<strong>{bucket.label}</strong>: {bucket.value.inserted} inserted, {bucket.value.alreadyPresent} already
				present
			</li>
		{/each}
	</ul>
</div>

<style>
	.workspace-import-result {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.section-label {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text-muted);
	}

	.bucket-counts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
		color: var(--color-text);
	}
</style>
