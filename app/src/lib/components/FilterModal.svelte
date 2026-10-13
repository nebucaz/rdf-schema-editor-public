<script lang="ts">
	/**
	 * workbench-columns (STORY-244): the filter dialog. One modal for a column's funnel (a fixed
	 * property), a group's entity filter, and "Add filter" (any property of a used class, including
	 * ones that are not columns). Existing filters on the chosen property open pre-filled and can be
	 * removed here. Applying replaces that property's filters with what the form emitted; every write
	 * goes through `store.setFilter`/`removeFilter` and every value through `makeFilter`, so nothing
	 * invalid reaches the model. Cancel/Escape/backdrop write nothing.
	 */
	import Modal from './Modal.svelte';
	import QueryPropertyFilterForm from './QueryPropertyFilterForm.svelte';
	import QueryEntityFilter from './QueryEntityFilter.svelte';
	import type { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { QueryModel } from '$lib/services/query-model';
	import {
		buildColumnGroups,
		filterableProperties,
		filtersForProperty,
		type FilterTarget
	} from '$lib/services/query-column-groups';
	import {
		describeFilter,
		makeFilter,
		prefillFromFilters,
		type FilterDraft
	} from '$lib/services/query-filter-editor';

	interface Props {
		isOpen: boolean;
		/** `null` while closed. */
		target: FilterTarget | null;
		model: QueryModel;
		schema: BuilderSchema;
		store: QueryBuilderStore;
		onClose: () => void;
	}

	let { isOpen, target, model, schema, store, onClose }: Props = $props();

	/** `'<hopId>|<propertyIri>'` while picking; `'<hopId>|'` = the group's entity. */
	let picked = $state('');
	const SEP = '|';
	const keyOf = (hopId: string | null, propertyIri: string | null) => `${hopId ?? ''}${SEP}${propertyIri ?? ''}`;

	// Opening (or retargeting) resets the pick to the target it names.
	$effect(() => {
		if (!isOpen || !target) return;
		picked = target.kind === 'property' ? keyOf(target.hopId, target.propertyIri)
			: target.kind === 'entity' ? keyOf(target.hopId, null) : '';
	});

	const groups = $derived(buildColumnGroups(model, schema));
	const filterable = $derived(filterableProperties(model, schema));
	const current = $derived.by(() => {
		if (!picked) return null;
		const [hop, iri] = picked.split(SEP);
		return { hopId: hop === '' ? null : hop, propertyIri: iri === '' ? null : iri };
	});
	const group = $derived(current ? groups.find((g) => g.hopId === current.hopId) ?? null : null);
	const entry = $derived(
		current?.propertyIri
			? filterable.find((p) => p.hopId === current.hopId && p.property.iri === current.propertyIri) ?? null
			: null
	);
	const existing = $derived(current ? filtersForProperty(model, current.hopId, current.propertyIri) : []);
	const entityClassIris = $derived(
		group ? [group.classIri, ...(schema.classes.get(group.classIri)?.subclasses ?? [])] : []
	);
	const title = $derived(
		current?.propertyIri === null && group
			? `Filter ${group.label}`
			: entry
				? `Filter ${entry.groupLabel} · ${entry.property.label}`
				: 'Add filter'
	);

	function removeExisting() {
		for (const f of existing) store.removeFilter(f.id);
	}
	function apply(drafts: FilterDraft[]) {
		removeExisting();
		for (const d of drafts) store.setFilter(d);
		onClose();
	}
	function pickEntity(e: { iri: string; label: string }) {
		if (!current) return;
		const r = makeFilter({ hopId: current.hopId, entity: e });
		if (r.ok) apply([r.filter]);
	}
	function remove() {
		removeExisting();
		onClose();
	}
</script>

<Modal {isOpen} {title} {onClose}>
	{#if target?.kind === 'pick'}
		<label class="pick">
			Filter on
			<select bind:value={picked} data-testid="filter-pick">
				<option value="" disabled>Choose a property…</option>
				{#each groups as g (g.hopId ?? 'root')}
					<optgroup label={g.label}>
						<option value={keyOf(g.hopId, null)}>{g.label} (the entity itself)</option>
						{#each filterable.filter((p) => p.hopId === g.hopId) as p (p.property.iri)}
							<option value={keyOf(p.hopId, p.property.iri)}>
								{p.property.label}{p.isColumn ? '' : ' (hidden column)'}
							</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>
	{/if}

	{#if current && current.propertyIri === null && group}
		{#if existing.length > 0}
			<p class="existing" data-testid="filter-existing">
				Current: {existing.map((f) => describeFilter(f, group.label)).join('; ')}
				<button type="button" onclick={remove} data-testid="filter-remove">Remove filter</button>
			</p>
		{/if}
		<QueryEntityFilter classIris={entityClassIris} onPick={pickEntity} onCancel={onClose} />
	{:else if current && entry}
		{#key picked}
			<QueryPropertyFilterForm
				property={entry.property}
				hopId={current.hopId}
				initial={prefillFromFilters(existing)}
				onSubmit={apply}
				onCancel={onClose}
				onRemove={existing.length > 0 ? remove : undefined}
			/>
		{/key}
		{#if !entry.isColumn}
			<p class="note">{entry.property.label} is not a column — the filter applies as a hidden column.</p>
		{/if}
	{/if}
</Modal>

<style>
	.pick {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}
	.existing,
	.note {
		font-size: 0.85rem;
		margin: 0.25rem 0 0.5rem;
	}
</style>
