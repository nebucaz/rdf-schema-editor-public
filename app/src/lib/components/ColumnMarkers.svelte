<script lang="ts">
	/**
	 * workbench-columns (STORY-245): the sort and filter markers of one column. Shared by the builder
	 * strip and the results table so both read the same `columnMarkers` state. Both are real buttons
	 * (keyboard reachable); the accessible name carries the state, and the filter's title shows its text.
	 */
	import type { ColumnMarkerState } from '$lib/services/query-column-groups';

	interface Props {
		state: ColumnMarkerState;
		/** Column header, for accessible names. */
		header: string;
		/** Click cycles asc → desc → none. Omitted = the sort marker is display-only. */
		onSort?: () => void;
		/** Opens the filter dialog. Omitted = no filter marker unless the column is filtered. */
		onFilter?: () => void;
	}

	let { state: marker, header, onSort, onFilter }: Props = $props();

	const arrow = $derived(
		marker.sort
			? `${marker.sort.direction === 'asc' ? '▲' : '▼'}${marker.multiSort ? marker.sort.rank : ''}`
			: '⇅'
	);
</script>

<span class="markers">
	{#if marker.sortable && (onSort || marker.sort)}
		{#if onSort}
			<button
				type="button"
				class="marker sort"
				class:active={marker.sort !== null}
				aria-label={`${header}: ${marker.sortLabel}. Click to change sort`}
				title={marker.sortLabel}
				data-testid="marker-sort"
				onclick={onSort}>{arrow}</button
			>
		{:else}
			<span class="marker sort active" role="img" aria-label={`${header}: ${marker.sortLabel}`} title={marker.sortLabel}>
				{arrow}
			</span>
		{/if}
	{/if}
	{#if onFilter}
		<button
			type="button"
			class="marker filter"
			class:active={marker.filterActive}
			aria-label={`${header}: ${marker.filterLabel}. Click to edit filter`}
			title={marker.filterText ?? 'Add filter'}
			data-testid="marker-filter"
			onclick={onFilter}>{marker.filterActive ? '⧩' : '⍒'}</button
		>
	{:else if marker.filterActive}
		<span class="marker filter active" role="img" aria-label={`${header}: ${marker.filterLabel}`} title={marker.filterText ?? ''}>⧩</span>
	{/if}
</span>

<style>
	.markers {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		margin-left: 0.25rem;
	}
	.marker {
		border: none;
		background: none;
		font: inherit;
		font-size: 0.8em;
		padding: 0 0.25rem;
		color: var(--color-text-muted);
		opacity: 0.55;
		cursor: pointer;
	}
	span.marker {
		cursor: default;
	}
	.marker.active {
		opacity: 1;
		color: var(--color-primary, var(--color-text));
	}
	.marker:focus-visible {
		outline: 2px solid var(--color-primary, currentColor);
		outline-offset: 1px;
		opacity: 1;
	}
</style>
