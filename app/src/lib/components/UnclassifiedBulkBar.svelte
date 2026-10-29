<script lang="ts">
	/**
	 * Bulk-assign controls for the Identities page in Unclassified mode (instances-issues STORY-010):
	 * select the visible page, widen it to everything matching the filters, pick a class and confirm.
	 * Above `TYPE_COUNT_ABOVE` the user must type the count, so a filter that matches far more than
	 * expected can't be applied by a single stray click. The page owns the selection and the writes.
	 */
	const TYPE_COUNT_ABOVE = 1000;

	interface Props {
		selectionCount: number;
		/** Every row on screen is selected. */
		pageSelected: boolean;
		/** The selection is "everything matching the current filters", not a list of rows. */
		allMatching: boolean;
		/** How many Unclassified individuals match the current filters, when known. */
		total: number | null;
		classOptions: { iri: string; label: string }[];
		/** Set while a run is in flight. */
		progress: { assigned: number; total: number } | null;
		canUndo: boolean;
		undoLabel?: string;
		onSelectPage: () => void;
		onSelectAllMatching: () => void;
		onClear: () => void;
		onApply: (classIri: string) => void;
		onCancelRun: () => void;
		onUndo: () => void;
	}

	let {
		selectionCount,
		pageSelected,
		allMatching,
		total,
		classOptions,
		progress,
		canUndo,
		undoLabel = '',
		onSelectPage,
		onSelectAllMatching,
		onClear,
		onApply,
		onCancelRun,
		onUndo
	}: Props = $props();

	let confirming = $state(false);
	let chosenClass = $state('');
	let typed = $state('');

	const needsTypedCount = $derived(selectionCount > TYPE_COUNT_ABOVE);
	const typedOk = $derived(!needsTypedCount || typed.replace(/\D/g, '') === String(selectionCount));
	const canApply = $derived(chosenClass !== '' && typedOk);
	const showSelectAll = $derived(pageSelected && !allMatching && total !== null && total > selectionCount);

	function openConfirm() {
		chosenClass = '';
		typed = '';
		confirming = true;
	}

	function apply() {
		if (!canApply) return;
		confirming = false;
		onApply(chosenClass);
	}
</script>

<div class="bulk-bar">
	{#if progress}
		<span>Assigning… {progress.assigned.toLocaleString()} of {progress.total.toLocaleString()}</span>
		<progress max={progress.total} value={progress.assigned}></progress>
		<button type="button" onclick={onCancelRun}>Cancel run</button>
	{:else if confirming}
		<div class="confirm" role="group" aria-label="Confirm class assignment">
			<p>
				Give <strong>{selectionCount.toLocaleString()} {selectionCount === 1 ? 'individual' : 'individuals'}</strong>
				a class:
			</p>
			<select aria-label="Class to assign" bind:value={chosenClass}>
				<option value="">Choose a class…</option>
				{#each classOptions as c (c.iri)}
					<option value={c.iri}>{c.label}</option>
				{/each}
			</select>
			{#if needsTypedCount}
				<label>
					Type {selectionCount.toLocaleString()} to confirm
					<input type="text" inputmode="numeric" aria-label="Type the number to confirm" bind:value={typed} />
				</label>
			{/if}
			<button type="button" onclick={apply} disabled={!canApply}>Apply</button>
			<button type="button" onclick={() => (confirming = false)}>Cancel</button>
		</div>
	{:else}
		<button type="button" onclick={onSelectPage}>Select this page</button>
		{#if selectionCount > 0}
			<span>{selectionCount.toLocaleString()} selected</span>
			{#if showSelectAll}
				<button type="button" onclick={onSelectAllMatching}>
					Select all {total!.toLocaleString()} matching
				</button>
			{/if}
			<button type="button" onclick={openConfirm}>Set class…</button>
			<button type="button" onclick={onClear}>Clear</button>
		{/if}
		{#if canUndo}
			<span class="undo-note">{undoLabel}</span>
			<button type="button" onclick={onUndo}>Undo</button>
		{/if}
	{/if}
</div>

<style>
	.bulk-bar,
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.bulk-bar {
		padding: 0.4rem 0;
	}
	.confirm p {
		margin: 0;
	}
	button,
	select,
	input {
		font: inherit;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg-secondary);
		color: inherit;
	}
	button:disabled {
		opacity: 0.5;
	}
	.undo-note {
		color: var(--color-text-muted, inherit);
	}
</style>
