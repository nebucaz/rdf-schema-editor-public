<script lang="ts">
	/**
	 * workbench-columns (STORY-246): the collapsible "Aggregate & limit" group — aggregation measures,
	 * HAVING thresholds and the row limit. Columns (STORY-241) and column sort (STORY-245 markers) live
	 * on the strip; only measures, which are not columns, are sortable from here. Every action goes
	 * through `QueryBuilderStore` → the pure helpers in `query-model-edit.ts`; this component only
	 * renders what `allowedSortKeys` etc. allow, so an invalid combination (sorting by an un-grouped
	 * column) cannot be produced from here.
	 */
	import type { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import { allowedSortKeys } from '$lib/services/query-model-edit';
	import {
		validateRunnableQueryModel,
		EXPORT_ROW_CAP,
		type HavingOp,
		type MeasureFn,
		type QueryModel
	} from '$lib/services/query-model';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import {
		havingMeasures,
		measureFnsForColumn,
		parseLimitInput,
		shapeGroupOpenByDefault
	} from '$lib/services/query-builder-parity';

	interface Props {
		model: QueryModel;
		store: QueryBuilderStore;
		knownClassIris?: ReadonlySet<string>;
		/** Needed for datatype-aware measure choices; without it only count/count-distinct are offered. */
		schema?: BuilderSchema;
	}

	let { model, store, knownClassIris, schema }: Props = $props();

	const sortKeys = $derived(allowedSortKeys(model));
	const labelOf = (id: string) => sortKeys.find((k) => k.id === id)?.label ?? id;
	const agg = $derived(model.aggregation);
	const issues = $derived(validateRunnableQueryModel(model, knownClassIris, schema));
	let open = $state(false);
	// Open when a loaded SPL/saved query/aggregation toggle brings in aggregation or a limit; never
	// force it shut again, so the user's own toggle sticks.
	const shouldOpen = $derived(shapeGroupOpenByDefault(model));
	$effect(() => {
		if (shouldOpen) open = true;
	});
	const sortDirectionOf = (alias: string) => model.sort.find((s) => s.columnId === alias)?.direction ?? null;
	let newMeasureOf = $state('root');
	let newMeasureFn = $state<MeasureFn>('count');

	const MEASURE_LABEL: Record<MeasureFn, string> = {
		count: 'COUNT', countDistinct: 'COUNT DISTINCT', sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX'
	};
	const HAVING_LABEL: Record<HavingOp, string> = {
		gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!='
	};
	const fnChoices = $derived(
		schema ? measureFnsForColumn(model, schema, newMeasureOf) : (['count', 'countDistinct'] as MeasureFn[])
	);
	// Switching the target column can make the chosen function unavailable; fall back to the first.
	const effectiveFn = $derived(fnChoices.includes(newMeasureFn) ? newMeasureFn : fnChoices[0]);
	const thresholdMeasures = $derived(
		schema ? havingMeasures(model, schema) : (agg?.measures ?? [])
	);
	let havingMeasure = $state('');
	let havingOp = $state<HavingOp>('gt');
	let havingValue = $state('');
	let havingError = $state<string | null>(null);
	const effectiveHavingMeasure = $derived(
		thresholdMeasures.some((m) => m.alias === havingMeasure) ? havingMeasure : (thresholdMeasures[0]?.alias ?? '')
	);

	function addThreshold() {
		const n = Number(havingValue);
		if (havingValue.trim() === '' || !Number.isFinite(n)) {
			havingError = 'Enter a number';
			return;
		}
		if (!effectiveHavingMeasure) {
			havingError = 'Add a measure first';
			return;
		}
		havingError = null;
		store.addHaving({ measure: effectiveHavingMeasure, op: havingOp, value: n });
		havingValue = '';
	}

	let limitText = $state('');
	let limitError = $state<string | null>(null);
	// Reflect the model (e.g. after loading SPL or a saved query) unless the user is mid-edit.
	$effect(() => {
		limitText = model.limit === undefined ? '' : String(model.limit);
	});

	function applyLimit() {
		const r = parseLimitInput(limitText);
		if (!r.ok) {
			limitError = r.error;
			return;
		}
		limitError = null;
		store.setLimit(r.value);
	}
</script>

<details class="group shape-group" bind:open data-testid="result-shape-panel">
	<summary>Aggregate &amp; limit</summary>
	<div class="shape-panel">
	<section>
		<h3>Aggregation</h3>
		<label>
			<input type="checkbox" checked={agg !== undefined} onchange={(e) => store.setAggregated(e.currentTarget.checked)} />
			Aggregate (count)
		</label>
		{#if agg}
			<p class="hint">Only grouped columns and measures are shown.</p>
			<ul>
				{#each agg.measures as m (m.alias)}
					<li>
						<span>{MEASURE_LABEL[m.fn]} of {m.of === 'root' ? 'entity' : (model.columns.find((c) => c.id === m.of)?.header ?? labelOf(m.of))} → {m.alias}</span>
						<button
							type="button"
							aria-label={`Sort by ${m.alias}`}
							data-testid="measure-sort"
							onclick={() => store.cycleSort(m.alias)}
						>
							{sortDirectionOf(m.alias) === 'asc' ? 'ASC' : sortDirectionOf(m.alias) === 'desc' ? 'DESC' : 'Sort'}
						</button>
						<button type="button" aria-label="Remove measure" onclick={() => store.removeMeasure(m.alias)}>×</button>
					</li>
				{/each}
			</ul>
			<div class="add-measure">
				<select aria-label="Measure function" value={effectiveFn} onchange={(e) => (newMeasureFn = e.currentTarget.value as MeasureFn)}>
					{#each fnChoices as fn (fn)}<option value={fn}>{MEASURE_LABEL[fn]}</option>{/each}
				</select>
				<select aria-label="Measure of" bind:value={newMeasureOf}>
					<option value="root">the entity</option>
					{#each model.columns as c (c.id)}<option value={c.id}>{c.header}</option>{/each}
				</select>
				<button type="button" onclick={() => store.addMeasure(effectiveFn, newMeasureOf)}>Add measure</button>
			</div>
			<h4>Keep only groups where</h4>
			{#if (agg.having ?? []).length > 0}
				<ul data-testid="having-list">
					{#each agg.having ?? [] as h, i (i)}
						<li>
							<span>{h.measure} {HAVING_LABEL[h.op]} {h.value}</span>
							<button type="button" aria-label="Remove threshold" onclick={() => store.removeHaving(i)}>×</button>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="add-measure" data-testid="having-form">
				<select aria-label="Threshold measure" value={effectiveHavingMeasure} onchange={(e) => (havingMeasure = e.currentTarget.value)}>
					{#each thresholdMeasures as m (m.alias)}<option value={m.alias}>{m.alias}</option>{/each}
				</select>
				<select aria-label="Threshold operator" bind:value={havingOp}>
					{#each Object.entries(HAVING_LABEL) as [op, sym] (op)}<option value={op}>{sym}</option>{/each}
				</select>
				<input type="number" step="any" aria-label="Threshold value" value={havingValue} oninput={(e) => (havingValue = e.currentTarget.value)} />
				<button type="button" onclick={addThreshold}>Add threshold</button>
				{#if havingError}<span class="error" role="alert">{havingError}</span>{/if}
			</div>
		{/if}
	</section>

	<section>
		<h3>Row limit</h3>
		<div class="add-measure">
			<input
				type="number"
				min="1"
				max={EXPORT_ROW_CAP}
				placeholder="No limit"
				aria-label="Row limit"
				value={limitText}
				oninput={(e) => (limitText = e.currentTarget.value)}
				onchange={applyLimit}
				data-testid="row-limit"
			/>
			<button type="button" onclick={applyLimit}>Apply</button>
			{#if limitError}<span class="error" role="alert">{limitError}</span>{/if}
		</div>
		{#if model.limit !== undefined && model.sort.length === 0}
			<p class="hint">Without a sort, the first {model.limit} rows are arbitrary.</p>
		{/if}
	</section>

	{#if issues.length > 0}
		<ul class="issues" role="status" data-testid="model-issues">
			{#each issues as issue (issue.path + issue.message)}<li>{issue.message}</li>{/each}
		</ul>
	{/if}
	</div>
</details>

<style>
	summary {
		cursor: pointer;
		font-weight: 600;
		font-size: 0.9rem;
	}
	.shape-panel {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem;
		margin-top: 0.75rem;
	}
	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.9rem;
	}
	ol,
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}
	.empty,
	.hint {
		margin: 0;
		opacity: 0.7;
		font-size: 0.85rem;
	}
	.add-measure {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
	}
	h4 {
		margin: 0.75rem 0 0.25rem;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-danger, #b00020);
		font-size: 0.8rem;
	}
	.issues {
		grid-column: 1 / -1;
		color: var(--color-danger, #b00020);
		font-size: 0.85rem;
	}
</style>
