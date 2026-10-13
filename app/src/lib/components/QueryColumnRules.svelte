<script lang="ts">
	/**
	 * STORY-197: the "Formatting" panel. Per column: an ordered list of value-to-colour rules (first
	 * match wins). Rendering only — every change goes through `QueryBuilderStore` → the pure helpers in
	 * `column-rules-editor.ts`, and colours are palette keys, so no free-form CSS can be produced.
	 */
	import type { QueryBuilderStore } from '$lib/stores/query-builder-store.svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { QueryModel } from '$lib/services/query-model';
	import {
		PALETTE_COLORS,
		RULE_OPS,
		chipStyle,
		ruleCellStyle,
		type ColumnRule,
		type PaletteColor,
		type RuleOp
	} from '$lib/services/column-rules';
	import { enumerationValuesForColumn, rulesForColumn } from '$lib/services/column-rules-editor';

	interface Props {
		model: QueryModel;
		schema: BuilderSchema;
		store: QueryBuilderStore;
	}

	let { model, schema, store }: Props = $props();

	const OP_LABEL: Record<RuleOp, string> = { eq: 'equals', contains: 'contains', isEmpty: 'is empty' };

	/** Rule colour per palette key as a preview chip (same tokens the table uses). */
	const swatch = (c: PaletteColor) => ruleCellStyle(c);

	let columnId = $state('');
	$effect(() => {
		if (!model.columns.some((c) => c.id === columnId)) columnId = model.columns[0]?.id ?? '';
	});

	const column = $derived(model.columns.find((c) => c.id === columnId));
	const members = $derived(column ? enumerationValuesForColumn(model, schema, column) : undefined);
	const columnRules = $derived(rulesForColumn(model.columnRules, columnId));

	let op = $state<RuleOp>('eq');
	let value = $state('');
	let color = $state<PaletteColor>('green');
	let asChip = $state(false);
	let tintRow = $state(false);

	const needsValue = $derived(op !== 'isEmpty');
	const canAdd = $derived(columnId !== '' && (!needsValue || value.trim() !== ''));

	function add() {
		if (!canAdd) return;
		const rule: ColumnRule = {
			columnId,
			match: needsValue ? { op, value: value.trim() } : { op },
			color,
			...(asChip ? { chip: true } : {}),
			...(tintRow ? { row: true } : {})
		};
		store.addRule(rule);
		value = '';
	}

	function describeRule(r: ColumnRule): string {
		const what = r.match.op === 'isEmpty' ? 'is empty' : `${OP_LABEL[r.match.op]} “${r.match.value ?? ''}”`;
		const how = [r.chip ? 'as chip' : '', r.row ? 'colours row' : ''].filter(Boolean).join(', ');
		return how ? `${what} — ${how}` : what;
	}
</script>

<details class="formatting group" data-testid="column-rules">
	<summary>Formatting{#if model.columnRules?.length} ({model.columnRules.length}){/if}</summary>

	{#if model.columns.length === 0}
		<p class="empty">Add a column to format its values.</p>
	{:else}
		<div class="row">
			<label>
				Column
				<select bind:value={columnId} data-testid="rule-column">
					{#each model.columns as c (c.id)}<option value={c.id}>{c.header}</option>{/each}
				</select>
			</label>
		</div>

		{#if columnRules.length === 0}
			<p class="empty">No rules for this column.</p>
		{:else}
			<ol class="rules" data-testid="rule-list">
				{#each columnRules as { index, rule }, position (index)}
					<li>
						<span class={rule.chip ? 'chip pill' : 'chip'} style={rule.chip ? chipStyle(rule.color) : swatch(rule.color)}>{rule.color}</span>
						<span>{describeRule(rule)}</span>
						<button
							type="button"
							aria-label="Move rule earlier"
							disabled={position === 0}
							onclick={() => store.moveRule(index, -1)}>↑</button
						>
						<button
							type="button"
							aria-label="Move rule later"
							disabled={position === columnRules.length - 1}
							onclick={() => store.moveRule(index, 1)}>↓</button
						>
						<button type="button" aria-label="Delete rule" onclick={() => store.removeRule(index)}>×</button>
					</li>
				{/each}
			</ol>
			<p class="hint">The first matching rule wins — reorder to change the outcome.</p>
		{/if}

		<form
			class="row add"
			onsubmit={(e) => {
				e.preventDefault();
				add();
			}}
		>
			<select bind:value={op} aria-label="Operator" data-testid="rule-op">
				{#each RULE_OPS as o (o)}<option value={o}>{OP_LABEL[o]}</option>{/each}
			</select>
			{#if needsValue}
				{#if members && op === 'eq'}
					<select bind:value aria-label="Value" data-testid="rule-value">
						<option value="" disabled>Choose a value…</option>
						{#each members as m (m.value)}<option value={m.value}>{m.label}</option>{/each}
					</select>
				{:else}
					<input type="text" bind:value placeholder="Value" aria-label="Value" data-testid="rule-value" />
				{/if}
			{/if}
			<select bind:value={color} aria-label="Colour" data-testid="rule-color">
				{#each PALETTE_COLORS as c (c)}<option value={c}>{c}</option>{/each}
			</select>
			<label class="opt">
				<input type="checkbox" bind:checked={asChip} data-testid="rule-chip" />
				Show as chip
			</label>
			<label class="opt">
				<input type="checkbox" bind:checked={tintRow} data-testid="rule-row" />
				Colour the whole row
			</label>
			<span class={asChip ? 'chip pill' : 'chip'} style={asChip ? chipStyle(color) : swatch(color)}>Sample</span>
			<button type="submit" disabled={!canAdd}>Add rule</button>
		</form>
	{/if}
</details>

<style>
	.formatting {
		margin: 0.75rem 0;
		font-size: 0.85rem;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.5rem;
	}
	.rules {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.rules li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.chip {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.8em;
	}
	.chip.pill {
		border-radius: 4px;
		font-weight: 700;
		text-transform: uppercase;
	}
	.opt {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	.empty,
	.hint {
		margin: 0.5rem 0 0;
		opacity: 0.7;
	}
</style>
