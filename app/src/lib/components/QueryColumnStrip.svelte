<script lang="ts">
	/**
	 * workbench-columns (STORY-241): the column-first builder surface. Renders `buildColumnGroups` —
	 * one block per class (root, then each hop, indented by depth) with a header cell per column
	 * (editable header, reorder within the group, remove) and a trailing "+ Add column". Every edit
	 * goes through `QueryBuilderStore`, so the model rules stay in `query-model-edit.ts`.
	 */
	import type { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { QueryModel } from '$lib/services/query-model';
	import {
		buildColumnGroups,
		columnMarkers,
		type ColumnGroup,
		type FilterTarget
	} from '$lib/services/query-column-groups';
	import ColumnMarkers from './ColumnMarkers.svelte';
	import QueryColumnGroupHeader from './QueryColumnGroupHeader.svelte';
	import { mode } from 'mode-watcher';
	import {
		groupKey,
		tintFor,
		workbenchGroupColorStore,
		type GroupColorStore
	} from '$lib/stores/workbench-group-color-store';

	interface Props {
		model: QueryModel;
		schema: BuilderSchema;
		store: QueryBuilderStore;
		/** Opens the filter dialog for a column's property, a group's entity, or any property. */
		onFilter: (target: FilterTarget) => void;
		/** Per-browser group tints; injectable for tests. */
		colors?: GroupColorStore;
		/** Opens the column dialog on one group (`null` = the root). */
		onEditColumns?: (hopId: string | null) => void;
	}

	let { model, schema, store, onFilter, colors = workbenchGroupColorStore, onEditColumns }: Props = $props();

	// View state only (STORY-248): collapse is per page visit, tint persists per browser; neither is in the model.
	let collapsedKeys = $state<Set<string>>(new Set());
	let tints = $state<Record<string, string | undefined>>({});
	const keyFor = (g: ColumnGroup) => groupKey(g.hopId, g.classIri);
	const storedTint = (g: ColumnGroup) => (keyFor(g) in tints ? tints[keyFor(g)] : colors.getColor(keyFor(g)));
	const isCollapsed = (g: ColumnGroup) => collapsedKeys.has(keyFor(g));
	function toggleCollapse(g: ColumnGroup) {
		const next = new Set(collapsedKeys);
		if (!next.delete(keyFor(g))) next.add(keyFor(g));
		collapsedKeys = next;
	}
	function setTint(g: ColumnGroup, color: string | undefined) {
		colors.setColor(keyFor(g), color);
		tints = { ...tints, [keyFor(g)]: color };
	}

	const groups = $derived(buildColumnGroups(model, schema));
	const markers = $derived(columnMarkers(model, schema));

	/**
	 * Moves a column to the place of another column of the same group by stepping it past columns of
	 * other groups too (the model keeps one flat column list).
	 */
	function moveBefore(group: ColumnGroup, fromId: string, toId: string) {
		if (fromId === toId || !group.columns.some((c) => c.column.id === fromId)) return;
		const from = model.columns.findIndex((c) => c.id === fromId);
		const to = model.columns.findIndex((c) => c.id === toId);
		if (from < 0 || to < 0) return;
		const delta: -1 | 1 = to < from ? -1 : 1;
		for (let i = 0; i < Math.abs(to - from); i++) store.moveColumn(fromId, delta);
	}

	function nudge(group: ColumnGroup, index: number, delta: -1 | 1) {
		const neighbour = group.columns[index + delta];
		if (neighbour) moveBefore(group, group.columns[index].column.id, neighbour.column.id);
	}

	// Drag state (view only). A box is draggable only while its handle is held, so text selection in the
	// header input and clicks on the markers keep working.
	let armedId = $state<string | null>(null);
	let dragging = $state<{ id: string; group: string } | null>(null);
	let overId = $state<string | null>(null);
	const groupId = (g: ColumnGroup) => g.hopId ?? 'root';
	const endDrag = () => {
		armedId = null;
		dragging = null;
		overId = null;
	};
</script>

<div class="column-strip" data-testid="column-strip">
	{#each groups as group (group.hopId ?? 'root')}
		<section
			class="group column-group"
			style:margin-left={`${group.depth * 1.25}rem`}
			style:background={tintFor(storedTint(group), mode.current === 'dark')}
			aria-label={`${group.label} columns`}
			data-testid="column-group"
		>
			<QueryColumnGroupHeader
				{group}
				{model}
				onToggleSubclasses={(include) => store.setIncludeSubclasses(include)}
				onEntityFilter={(hopId) => onFilter({ kind: 'entity', hopId })}
				onRemove={(hopId) => (hopId === null ? store.close() : store.removeHop(hopId))}
				collapsed={isCollapsed(group)}
				color={storedTint(group)}
				onToggleCollapse={() => toggleCollapse(group)}
				onColor={(c) => setTint(group, c)}
				{onEditColumns}
			/>
			{#if isCollapsed(group)}
				<!-- Collapsed: the header carries the column count. -->
			{:else if group.columns.length === 0}
				<p class="empty">No columns from {group.label} yet.</p>
			{:else}
				<ul class="cells">
					{#each group.columns as gc, i (gc.column.id)}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<li
							class="cell"
							class:drop-target={overId === gc.column.id && dragging?.id !== gc.column.id}
							class:dragging={dragging?.id === gc.column.id}
							data-testid="column-cell"
							draggable={armedId === gc.column.id}
							ondragstart={(e) => {
								if (armedId !== gc.column.id) return;
								dragging = { id: gc.column.id, group: groupId(group) };
								e.dataTransfer?.setData('text/plain', gc.column.id);
								if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
							}}
							ondragover={(e) => {
								if (dragging && dragging.group === groupId(group)) {
									e.preventDefault();
									overId = gc.column.id;
								}
							}}
							ondrop={(e) => {
								if (!dragging || dragging.group !== groupId(group)) return;
								e.preventDefault();
								moveBefore(group, dragging.id, gc.column.id);
								endDrag();
							}}
							ondragend={endDrag}
						>
							<div class="cell-header" data-testid="cell-header">
								<button
									type="button"
									class="handle"
									data-testid="cell-handle"
									aria-label={`Move column ${gc.column.header} (drag, or use arrow keys)`}
									title="Drag to reorder"
									onmousedown={() => (armedId = gc.column.id)}
									onmouseup={() => (armedId = null)}
									onkeydown={(e) => {
										const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1
											: e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
										if (delta === 0) return;
										e.preventDefault();
										nudge(group, i, delta);
									}}>⠿</button
								>
								<span class="spacer"></span>
								<button
									type="button"
									class="remove-column"
									aria-label="Remove column"
									title="Remove column"
									onclick={() => store.removeColumn(gc.column.id)}>×</button
								>
							</div>
							<input
								type="text"
								aria-label="Column header"
								value={gc.column.header}
								onchange={(e) => store.setColumnHeader(gc.column.id, e.currentTarget.value)}
							/>
							<span class="from">{gc.propertyLabel}</span>
							{#if markers.get(gc.column.id)}
								{@const src = gc.column.source}
								<ColumnMarkers
									state={markers.get(gc.column.id)!}
									header={gc.column.header}
									onSort={gc.sortable ? () => store.cycleSort(gc.column.id) : undefined}
									onFilter={typeof src === 'object' && markers.get(gc.column.id)?.filterable
										? () => onFilter({ kind: 'property', hopId: group.hopId, propertyIri: src.propertyIri })
										: undefined}
								/>
							{/if}
							{#if model.aggregation}
								<label class="group-by">
									<input
										type="checkbox"
										checked={model.aggregation.groupBy.includes(gc.column.id)}
										onchange={() => store.toggleGroupBy(gc.column.id)}
									/>
									Group by
								</label>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</div>

<style>
	.column-strip {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.column-group {
		padding: 0.75rem;
	}
	.cells {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.375rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
	}
	.from {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.group-by {
		font-size: 0.8rem;
	}
	.cell-header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: -0.375rem -0.375rem 0.25rem;
		padding: 0.125rem 0.25rem;
		border-bottom: 1px solid var(--color-border);
		border-radius: 6px 6px 0 0;
		background: var(--color-group-bg);
	}
	.spacer {
		flex: 1;
	}
	.handle {
		cursor: grab;
		border: none;
		background: transparent;
		padding: 0 0.25rem;
		line-height: 1.2;
	}
	.handle:active {
		cursor: grabbing;
	}
	.remove-column {
		border: none;
		background: transparent;
		padding: 0 0.25rem;
		line-height: 1.2;
	}
	.cell.dragging {
		opacity: 0.5;
	}
	.cell.drop-target {
		outline: 2px dashed var(--color-accent);
		outline-offset: 2px;
	}
	.empty {
		margin: 0.5rem 0 0;
		opacity: 0.7;
		font-size: 0.85rem;
	}
</style>
