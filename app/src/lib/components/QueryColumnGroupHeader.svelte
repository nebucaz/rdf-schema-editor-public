<script lang="ts">
	/**
	 * workbench-columns (STORY-241): header of one column group — class, the relationship it was
	 * reached through, the root's Include-subclasses toggle and the group × with its confirmation.
	 * Removal never silently drops work: anything attached (filters, sort, measures, child groups) is
	 * listed first; the root is blocked while child groups exist.
	 *
	 * STORY-248: a collapse toggle (the strip owns the state) and a tint picker from the verified
	 * `GROUP_TINTS` palette; neither touches the model.
	 */
	import type { ColumnGroup } from '$lib/services/query-column-groups';
	import { groupRemovalSummary, isDestructive } from '$lib/services/query-group-removal';
	import type { QueryModel } from '$lib/services/query-model';
	import { GROUP_TINTS } from '$lib/stores/workbench-group-color-store';

	interface Props {
		group: ColumnGroup;
		model: QueryModel;
		onToggleSubclasses: (include: boolean) => void;
		onRemove: (hopId: string | null) => void;
		/** Opens the entity-filter dialog for this group. */
		onEntityFilter?: (hopId: string | null) => void;
		/** Collapsed to the header (the column count is shown instead of the columns). */
		collapsed?: boolean;
		/** Stored (light) tint, or `undefined` for the default group background. */
		color?: string;
		onToggleCollapse?: () => void;
		onColor?: (color: string | undefined) => void;
		/** Opens the column dialog on this group, ticked with its current columns. */
		onEditColumns?: (hopId: string | null) => void;
	}

	let {
		group,
		model,
		onToggleSubclasses,
		onRemove,
		onEntityFilter,
		collapsed = false,
		color,
		onToggleCollapse,
		onColor,
		onEditColumns
	}: Props = $props();

	let confirming = $state(false);
	const summary = $derived(groupRemovalSummary(model, group.hopId));
	const dropped = $derived(
		[
			summary.groups > 1 ? `${summary.groups - 1} nested group${summary.groups > 2 ? 's' : ''}` : '',
			summary.columns > 0 ? `${summary.columns} column${summary.columns > 1 ? 's' : ''}` : '',
			summary.filters > 0 ? `${summary.filters} filter${summary.filters > 1 ? 's' : ''}` : '',
			summary.sortKeys > 0 ? `${summary.sortKeys} sort key${summary.sortKeys > 1 ? 's' : ''}` : '',
			summary.measures > 0 ? `${summary.measures} measure${summary.measures > 1 ? 's' : ''}` : ''
		].filter(Boolean)
	);

	function requestRemove() {
		if (summary.blockedReason) return;
		if (isDestructive(summary)) confirming = true;
		else onRemove(group.hopId);
	}
</script>

<div class="group-header" data-testid={group.isRoot ? 'group-header-root' : 'group-header'}>
	<div class="title">
		{#if onToggleCollapse}
			<button
				type="button"
				class="collapse"
				aria-expanded={!collapsed}
				aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.label}`}
				data-testid="group-collapse"
				onclick={onToggleCollapse}>{collapsed ? '▸' : '▾'}</button
			>
		{/if}
		{#if group.viaLabel}<span class="via">{group.viaLabel}</span>{/if}
		<strong>{group.label}</strong>
		{#if group.isRoot}
			<label class="subclasses">
				<input
					type="checkbox"
					checked={model.root.includeSubclasses}
					onchange={(e) => onToggleSubclasses(e.currentTarget.checked)}
				/>
				Include subclasses
			</label>
		{/if}
		{#if collapsed}
			<span class="count" data-testid="group-column-count">
				{group.columns.length} column{group.columns.length === 1 ? '' : 's'}
			</span>
		{/if}
	</div>
	{#if onColor}
		<span class="tints" role="group" aria-label={`Colour for ${group.label}`}>
			<button
				type="button"
				class="tint none"
				class:selected={color === undefined}
				aria-label="Default colour"
				aria-pressed={color === undefined}
				onclick={() => onColor(undefined)}>∅</button
			>
			{#each GROUP_TINTS as t (t.light)}
				<button
					type="button"
					class="tint"
					class:selected={color === t.light}
					style:--tint-light={t.light}
					style:--tint-dark={t.dark}
					aria-label={`Colour ${t.light}`}
					aria-pressed={color === t.light}
					data-testid="group-tint"
					onclick={() => onColor(t.light)}
				></button>
			{/each}
		</span>
	{/if}
	{#if onEditColumns}
		<button
			type="button"
			aria-label={`Edit columns of ${group.label}`}
			data-testid="group-edit-columns"
			onclick={() => onEditColumns(group.hopId)}>✎ Columns</button
		>
	{/if}
	{#if onEntityFilter}
		<button
			type="button"
			aria-label={`Filter ${group.label} by entity`}
			data-testid="group-entity-filter"
			onclick={() => onEntityFilter(group.hopId)}>⧩ Entity</button
		>
	{/if}
	<button
		type="button"
		class="remove"
		aria-label={`Remove group ${group.label}`}
		aria-disabled={summary.blockedReason !== null}
		title={summary.blockedReason ?? `Remove ${group.label}`}
		onclick={requestRemove}
	>
		×
	</button>
</div>
{#if group.isRoot && summary.blockedReason}
	<p class="note" data-testid="root-removal-blocked">{summary.blockedReason}</p>
{/if}
{#if confirming}
	<div class="confirm" role="alertdialog" aria-label={`Remove ${group.label}?`} data-testid="group-remove-confirm">
		<p>Removing <strong>{group.label}</strong> also drops {dropped.join(', ')}.</p>
		<button
			type="button"
			onclick={() => {
				confirming = false;
				onRemove(group.hopId);
			}}>Remove</button
		>
		<button type="button" onclick={() => (confirming = false)}>Cancel</button>
	</div>
{/if}

<style>
	.group-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.title {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.via {
		opacity: 0.7;
		font-size: 0.85rem;
	}
	.subclasses {
		font-size: 0.85rem;
	}
	.remove[aria-disabled='true'] {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.collapse {
		min-width: 1.75rem;
	}
	.count {
		font-size: 0.85rem;
		opacity: 0.75;
	}
	.tints {
		display: inline-flex;
		gap: 0.25rem;
		margin-left: auto;
	}
	.tint {
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border-radius: 50%;
		border: 1px solid var(--color-group-border);
		background: var(--tint-light);
		font-size: 0.65rem;
		line-height: 1;
	}
	:global(:root.dark) .tint {
		background: var(--tint-dark);
	}
	.tint.none {
		background: transparent;
	}
	.tint.selected {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.note,
	.confirm p {
		margin: 0.25rem 0;
		font-size: 0.85rem;
	}
	.confirm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
</style>
