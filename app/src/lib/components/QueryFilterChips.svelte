<script lang="ts">
	/**
	 * STORY-190 → workbench-columns STORY-245: the titled Filter group above the columns. One chip per
	 * property (a `gte` + `lt` range is one chip) and per entity filter, from `filterMarkers`. Clicking
	 * a chip edits it in the filter dialog, × removes it, filters on non-column properties are tagged
	 * "hidden column", and "Add filter" opens the dialog to pick any property. Shown even when empty.
	 */
	import type { FilterMarker } from '$lib/services/query-column-groups';

	interface Props {
		markers: FilterMarker[];
		onEdit: (marker: FilterMarker) => void;
		/** Removes every filter the chip stands for. */
		onRemove: (marker: FilterMarker) => void;
		onAdd: () => void;
	}

	let { markers, onEdit, onRemove, onAdd }: Props = $props();
</script>

<section class="group filter-group" aria-label="Filter" data-testid="filter-group">
	<div class="head">
		<strong>Filter</strong>
		<button type="button" onclick={onAdd} data-testid="filter-group-add">+ Add filter</button>
	</div>
	{#if markers.length === 0}
		<p class="empty" data-testid="filter-group-empty">No filters — every matching row is returned.</p>
	{:else}
		<ul class="chips" data-testid="filter-chips">
			{#each markers as m (`${m.hopId ?? ''}|${m.propertyIri ?? m.filters[0].id}`)}
				<li>
					<button type="button" class="chip-text" onclick={() => onEdit(m)} aria-label={`Edit filter: ${m.text}`}>
						{m.text}
					</button>
					{#if m.hidden}<span class="tag" title="This property is not one of the columns">hidden column</span>{/if}
					<button type="button" class="remove" aria-label={`Remove filter: ${m.text}`} onclick={() => onRemove(m)}>×</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.filter-group {
		margin-bottom: 0.75rem;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.empty {
		margin: 0.5rem 0 0;
		font-size: 0.85rem;
		opacity: 0.7;
	}
	.chips {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}
	li {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.125rem 0.5rem;
		font-size: 0.8rem;
		background: var(--color-bg);
	}
	.chip-text {
		border: none;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
		padding: 0;
	}
	.tag {
		font-size: 0.7rem;
		opacity: 0.7;
		border: 1px dashed var(--color-border);
		border-radius: 4px;
		padding: 0 0.25rem;
	}
	.remove {
		padding: 0 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		line-height: 1.2;
		cursor: pointer;
	}
	.remove:hover {
		border-color: var(--color-error);
		background: var(--color-error-bg);
		color: var(--color-error);
	}
</style>
