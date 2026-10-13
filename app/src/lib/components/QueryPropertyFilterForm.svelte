<script lang="ts">
	/**
	 * STORY-190: inline filter editor for one property. Operators come from `operatorsForProperty`;
	 * enumerated properties render a dropdown (multi-select for `in`) from the schema's members, with
	 * no per-class code. Validation lives in `makeFilter`, so invalid input never reaches the model.
	 *
	 * workbench-columns (STORY-244): hosted by `FilterModal`. `initial` pre-fills the form from the
	 * property's existing filters (`prefillFromFilters`); `onSubmit` receives the whole set the form
	 * emits (one filter, or the `gte`/`lt` pair of a range) so the caller can replace the old set.
	 */
	import type { BuilderProperty } from '$lib/services/query-builder-schema';
	import type { FilterOp } from '$lib/services/query-model';
	import {
		makeFilter,
		makeRangeFilters,
		operatorsForProperty,
		type FilterPrefill,
		type FilterDraft
	} from '$lib/services/query-filter-editor';
	import { isNumericDatatype, isTemporalDatatype } from '$lib/services/query-datatypes';

	interface Props {
		property: BuilderProperty;
		hopId: string | null;
		/** Pre-fill for edit mode (empty defaults when omitted). */
		initial?: FilterPrefill;
		onSubmit: (drafts: FilterDraft[]) => void;
		onCancel: () => void;
		/** Edit mode: removes the property's existing filters. Omitted = no Remove button. */
		onRemove?: () => void;
	}

	let { property, hopId, initial, onSubmit, onCancel, onRemove }: Props = $props();

	const operators = $derived(operatorsForProperty(property));
	const allowed = $derived(property.allowedValues ?? []);
	// svelte-ignore state_referenced_locally
	let op = $state<FilterOp | null>(initial?.op ?? null);
	// svelte-ignore state_referenced_locally
	let value = $state(initial?.value ?? '');
	// svelte-ignore state_referenced_locally
	let values = $state<string[]>(initial?.values ?? []);
	let error = $state<string | null>(null);
	// svelte-ignore state_referenced_locally
	let range = $state(initial?.range ?? false);
	// svelte-ignore state_referenced_locally
	let from = $state(initial?.from ?? '');
	// svelte-ignore state_referenced_locally
	let to = $state(initial?.to ?? '');
	const rangeAllowed = $derived(operators.includes('gte'));
	/** Native picker by schema datatype; free text for everything else. */
	const inputType = $derived.by(() => {
		const dt = property.datatype;
		if (isNumericDatatype(dt)) return 'number';
		if (isTemporalDatatype(dt)) return dt.endsWith('#date') ? 'date' : 'datetime-local';
		return 'text';
	});
	const step = $derived(inputType === 'number' ? 'any' : inputType === 'datetime-local' ? '1' : undefined);
	const effectiveOp = $derived(op ?? operators[0]);
	const needsValue = $derived(effectiveOp !== 'isEmpty' && effectiveOp !== 'isNotEmpty');

	const OP_LABEL: Record<FilterOp, string> = {
		eq: 'equals', neq: 'not equal', contains: 'contains', isEmpty: 'is empty',
		isNotEmpty: 'is not empty', in: 'is one of', gt: 'greater than', gte: 'at least',
		lt: 'less than', lte: 'at most'
	};

	function submit(event: Event) {
		event.preventDefault();
		if (range && rangeAllowed) {
			const rr = makeRangeFilters({ hopId, property, from, to });
			if (!rr.ok) {
				error = rr.error;
				return;
			}
			error = null;
			onSubmit(rr.filters);
			return;
		}
		const r = makeFilter({ hopId, property, op: effectiveOp, value, values });
		if (!r.ok) {
			error = r.error;
			return;
		}
		error = null;
		onSubmit([r.filter]);
	}
</script>

<form class="filter-form" onsubmit={submit} data-testid="property-filter-form">
	{#if rangeAllowed}
		<label class="range-toggle">
			<input type="checkbox" bind:checked={range} data-testid="filter-range" />
			Range
		</label>
	{/if}
	{#if range && rangeAllowed}
		<input type={inputType} {step} aria-label="From (at least)" value={from} oninput={(e) => (from = e.currentTarget.value)} />
		<span aria-hidden="true">to</span>
		<input type={inputType} {step} aria-label="To (before)" value={to} oninput={(e) => (to = e.currentTarget.value)} />
	{:else}
	<select aria-label="Operator" bind:value={op}>
		{#each operators as o (o)}<option value={o}>{OP_LABEL[o]}</option>{/each}
	</select>
	{#if needsValue}
		{#if allowed.length > 0 && effectiveOp === 'in'}
			<select multiple aria-label="Values" bind:value={values}>
				{#each allowed as v (v.value)}<option value={v.value}>{v.label}</option>{/each}
			</select>
		{:else if allowed.length > 0}
			<select aria-label="Value" bind:value>
				<option value="" disabled>Choose…</option>
				{#each allowed as v (v.value)}<option value={v.value}>{v.label}</option>{/each}
			</select>
		{:else}
			<input type={inputType} {step} aria-label="Value" {value} oninput={(e) => (value = e.currentTarget.value)} />
		{/if}
	{/if}
	{/if}
	<button type="submit">Apply</button>
	<button type="button" onclick={onCancel}>Cancel</button>
	{#if onRemove}<button type="button" onclick={onRemove} data-testid="filter-remove">Remove filter</button>{/if}
	{#if error}<span class="error" role="alert">{error}</span>{/if}
</form>

<style>
	.filter-form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin: 0.25rem 0 0.5rem;
	}
	.range-toggle {
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-danger, #b00020);
		font-size: 0.8rem;
	}
</style>
