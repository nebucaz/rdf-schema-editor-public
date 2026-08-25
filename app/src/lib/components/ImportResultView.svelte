<script lang="ts">
	import type { ImportedTripleInfo, ImportSummary } from '$lib/services/sparql-connector';
	import { extractLocalName } from '$lib/utils/iri';

	interface Props {
		summary: ImportSummary;
	}

	let { summary }: Props = $props();

	function describe(t: ImportedTripleInfo): string {
		return `${extractLocalName(t.subject)} ${extractLocalName(t.predicate)}`;
	}
</script>

<div class="import-result">
	<ul class="counts">
		<li><strong>{summary.inserted.length}</strong> triple{summary.inserted.length === 1 ? '' : 's'} inserted</li>
		<li><strong>{summary.duplicates.length}</strong> skipped as duplicate{summary.duplicates.length === 1 ? '' : 's'}</li>
		<li><strong>{summary.conflicts.length}</strong> skipped due to conflict{summary.conflicts.length === 1 ? '' : 's'}</li>
	</ul>

	{#if summary.duplicates.length > 0}
		<p class="section-label">
			Already present in the graph (same subject, predicate and value) — not re-inserted:
		</p>
		<ul class="triple-list">
			{#each summary.duplicates as t (t.subject + t.predicate)}
				<li>{describe(t)}</li>
			{/each}
		</ul>
	{/if}

	{#if summary.conflicts.length > 0}
		<p class="section-label conflict">
			Conflicts with an existing value for the same subject and predicate — skipped, not
			overwritten:
		</p>
		<ul class="triple-list conflict">
			{#each summary.conflicts as t (t.subject + t.predicate)}
				<li>{describe(t)}</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.import-result {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.counts {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}

	.section-label {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.section-label.conflict {
		color: var(--color-error);
	}

	.triple-list {
		margin: 0;
		padding-left: 1.25rem;
		max-height: 160px;
		overflow-y: auto;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.triple-list.conflict {
		color: var(--color-error);
	}
</style>
