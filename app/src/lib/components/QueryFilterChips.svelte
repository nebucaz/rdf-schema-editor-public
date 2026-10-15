<script lang="ts">
	/**
	 * STORY-190 → workbench-columns STORY-245: the titled Filter group above the columns. One chip per
	 * property (a `gte` + `lt` range is one chip) and per entity filter, from `filterMarkers`. Clicking
	 * a chip edits it in the filter dialog, × removes it, filters on non-column properties are tagged
	 * "hidden column", and "Add filter" opens the dialog to pick any property. Shown even when empty.
	 *
	 * STORY-232 on the column-first builder: chips can be selected and grouped as "any of" (OR). A group
	 * is drawn as one bordered block, can be dissolved as a whole, and a member can be taken out of it.
	 * A range chip (`gte` + `lt`) cannot be grouped — OR-ing its two bounds would change what it means.
	 */
	import type { FilterMarker } from '$lib/services/query-column-groups';

	interface Props {
		markers: FilterMarker[];
		onEdit: (marker: FilterMarker) => void;
		/** Removes every filter the chip stands for. */
		onRemove: (marker: FilterMarker) => void;
		onAdd: () => void;
		onGroup?: (filterIds: string[]) => void;
		onUngroup?: (groupId: string) => void;
		/** Takes every filter the chip stands for out of its group. */
		onRemoveFromGroup?: (marker: FilterMarker) => void;
	}

	let { markers, onEdit, onRemove, onAdd, onGroup, onUngroup, onRemoveFromGroup }: Props = $props();

	const keyOf = (m: FilterMarker) => `${m.hopId ?? ''}|${m.propertyIri ?? m.filters[0].id}`;
	const groupOf = (m: FilterMarker) => m.filters.find((f) => f.orGroup)?.orGroup ?? null;
	const groupable = (m: FilterMarker) => m.filters.length === 1;

	let selected = $state<string[]>([]);
	let announcement = $state('');

	// Selection of a chip that no longer exists is ignored (and dropped on the next change).
	const picked = $derived(markers.filter((m) => selected.includes(keyOf(m)) && groupable(m)));
	const canGroup = $derived(!!onGroup && picked.length >= 2);

	/** Chips of one group render together, at the position of the group's first chip. */
	const blocks = $derived.by(() => {
		const out: { group: string | null; items: FilterMarker[] }[] = [];
		const byGroup = new Map<string, { group: string | null; items: FilterMarker[] }>();
		for (const m of markers) {
			const g = groupOf(m);
			if (g === null) {
				out.push({ group: null, items: [m] });
				continue;
			}
			let b = byGroup.get(g);
			if (!b) {
				b = { group: g, items: [] };
				byGroup.set(g, b);
				out.push(b);
			}
			b.items.push(m);
		}
		return out;
	});

	function toggle(m: FilterMarker): void {
		const k = keyOf(m);
		selected = selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k];
	}

	function group(): void {
		if (!onGroup || picked.length < 2) return;
		onGroup(picked.flatMap((m) => m.filters.map((f) => f.id)));
		announcement = `Grouped ${picked.length} filters: any of them may match.`;
		selected = [];
	}
</script>

{#snippet chip(m: FilterMarker, inGroup: boolean)}
	<li class="chip">
		{#if onGroup}
			<input
				type="checkbox"
				aria-label={`Select filter ${m.text}`}
				disabled={!groupable(m)}
				title={groupable(m) ? undefined : 'A range cannot be grouped'}
				checked={picked.includes(m)}
				onchange={() => toggle(m)}
			/>
		{/if}
		<button type="button" class="chip-text" onclick={() => onEdit(m)} aria-label={`Edit filter: ${m.text}`}>
			{m.text}
		</button>
		{#if m.hidden}<span class="tag" title="This property is not one of the columns">hidden column</span>{/if}
		{#if inGroup && onRemoveFromGroup}
			<button
				type="button"
				class="quiet"
				aria-label={`Take ${m.text} out of the group`}
				title="Take out of the group"
				onclick={() => {
					onRemoveFromGroup(m);
					announcement = 'Filter taken out of the group.';
				}}>⤴</button
			>
		{/if}
		<button type="button" class="remove" aria-label={`Remove filter: ${m.text}`} onclick={() => onRemove(m)}>×</button>
	</li>
{/snippet}

<section class="group filter-group" aria-label="Filter" data-testid="filter-group">
	<div class="head">
		<strong>Filter</strong>
		<span class="actions">
			{#if onGroup && markers.length >= 2}
				<button
					type="button"
					disabled={!canGroup}
					title={canGroup ? 'Match any of the selected filters' : 'Select two or more filters first'}
					onclick={group}>Group as “any of”</button
				>
			{/if}
			<button type="button" onclick={onAdd} data-testid="filter-group-add">+ Add filter</button>
		</span>
	</div>
	{#if markers.length === 0}
		<p class="empty" data-testid="filter-group-empty">No filters — every matching row is returned.</p>
	{:else}
		<ul class="chips" data-testid="filter-chips">
			{#each blocks as block (keyOf(block.items[0]))}
				{#if block.group !== null}
					<li class="or-group" data-testid="or-group">
						<ul role="group" aria-label="Any of these filters">
							<li class="group-label">Any of</li>
							{#each block.items as m, i (keyOf(m))}
								{#if i > 0}<li class="or" aria-hidden="true">or</li>{/if}
								{@render chip(m, true)}
							{/each}
							{#if onUngroup}
								<li class="plain">
									<button
										type="button"
										class="quiet"
										onclick={() => {
											onUngroup(block.group!);
											announcement = 'Group dissolved: all filters must match again.';
										}}>Ungroup</button
									>
								</li>
							{/if}
						</ul>
					</li>
				{:else}
					{@render chip(block.items[0], false)}
				{/if}
			{/each}
		</ul>
	{/if}
	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
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
	.chip {
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
	.actions {
		display: inline-flex;
		gap: 0.375rem;
	}
	.or-group {
		border: 1px solid var(--color-border);
		border-radius: 0.5rem;
		padding: 0.125rem 0.375rem;
		background: var(--color-bg-secondary);
	}
	.or-group > ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
	}
	.group-label,
	.or {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.or-group li.plain,
	.or-group li.group-label,
	.or-group li.or {
		list-style: none;
	}
	button.quiet {
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		opacity: 0.7;
	}
	button.quiet:hover {
		opacity: 1;
		text-decoration: underline;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
