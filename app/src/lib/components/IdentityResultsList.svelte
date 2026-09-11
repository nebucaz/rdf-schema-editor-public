<script lang="ts">
	/**
	 * Grouped, paginated result list for the Identities route (STORY-118), ported from
	 * `semantic-crm`'s `ResultsList.svelte` — grouped by primary type (here: `classIri`, since every
	 * result already carries exactly one, unlike the ported original's `types[]`). Distinguishes
	 * "nothing searched yet" from "searched, zero results" via `hasSearched`, mirroring the original's
	 * `query`-presence check.
	 */
	import type { FetchedClass, FetchedNamespace, IndividualSearchResult } from '$lib/services/sparql-connector';
	import { displayLabel, labelOrPrettify } from '$lib/utils/resource-page-format';

	interface Props {
		results: IndividualSearchResult[];
		selectedIri?: string | null;
		hasSearched: boolean;
		hasMore: boolean;
		isLoading?: boolean;
		/** Used to resolve each group's real class label and owning-namespace prefix — same
		 *  disambiguation `IdentitySearchBar`'s "Filter by class" options apply, needed here too
		 *  since two namespaces can each own a class with the same local name. */
		classes: FetchedClass[];
		namespaces: FetchedNamespace[];
		onSelect: (result: IndividualSearchResult) => void;
		onLoadMore: () => void;
	}

	let {
		results,
		selectedIri,
		hasSearched,
		hasMore,
		isLoading = false,
		classes,
		namespaces,
		onSelect,
		onLoadMore
	}: Props = $props();

	interface ResultGroup {
		key: string;
		label: string;
		items: IndividualSearchResult[];
	}

	const classByIri = $derived(new Map(classes.map((c) => [c.iri, c])));
	const namespacePrefixByBaseIri = $derived(new Map(namespaces.map((ns) => [ns.baseIri, ns.prefix])));

	function groupLabel(classIri: string): string {
		const cls = classByIri.get(classIri);
		const label = labelOrPrettify(cls?.label, classIri);
		const prefix = cls && namespacePrefixByBaseIri.get(cls.namespaceBaseIri);
		return prefix ? `${label} [${prefix}]` : label;
	}

	const groups = $derived.by<ResultGroup[]>(() => {
		const byKey = new Map<string, ResultGroup>();
		for (const item of results) {
			let group = byKey.get(item.classIri);
			if (!group) {
				group = { key: item.classIri, label: groupLabel(item.classIri), items: [] };
				byKey.set(item.classIri, group);
			}
			group.items.push(item);
		}
		return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
	});
</script>

<div class="identity-results-list">
	{#if results.length === 0}
		<div class="empty-state">
			{#if hasSearched}
				<p class="no-results">No identities found.</p>
			{:else}
				<p class="no-results">Search or pick a facet to browse identities.</p>
			{/if}
		</div>
	{:else}
		{#each groups as group (group.key)}
			<section class="result-group">
				<h3>{group.label} ({group.items.length})</h3>
				<ul>
					{#each group.items as item (item.iri)}
						<li>
							<button
								type="button"
								class="result-row"
								class:active={selectedIri === item.iri}
								aria-current={selectedIri === item.iri ? 'true' : undefined}
								onclick={() => onSelect(item)}
							>
								<span class="result-label">{displayLabel(item.label)}</span>
								{#if item.syncSource}
									<span class="result-hint">synced via {item.syncSource}{item.syncStatus ? ` · ${item.syncStatus}` : ''}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
		{#if hasMore}
			<button type="button" class="load-more-btn" onclick={onLoadMore} disabled={isLoading}>
				{isLoading ? 'Loading…' : 'Load more'}
			</button>
		{/if}
	{/if}
</div>

<style>
	.identity-results-list {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
	}

	.result-group {
		margin-bottom: 1rem;
	}

	.result-group:last-child {
		margin-bottom: 0;
	}

	.result-group h3 {
		margin: 0 0 0.5rem;
		color: var(--color-text);
		font-size: 0.95rem;
	}

	.result-group ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.35rem;
	}

	.result-row {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		text-align: left;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
		font: inherit;
	}

	.result-row:hover {
		border-color: var(--color-accent);
	}

	.result-row.active {
		border-color: var(--color-accent);
		background: var(--color-bg-secondary);
	}

	.result-label {
		font-weight: 600;
	}

	.result-hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.load-more-btn {
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	.load-more-btn:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.load-more-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		text-align: center;
	}

	.no-results {
		color: var(--color-text-muted);
	}
</style>
