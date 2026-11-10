<script lang="ts">
	/** The semantic debt list (ontology-pipeline STORY-334): known quality debts with filters, links to the
	 *  element and the two settings (question review period, concept staleness). Read-only. */
	import { parseDebtSettings, type DebtSettings } from '#lib/services/debt-settings.js';
	import { DEBT_KINDS, filterDebt, type DebtItem, type DebtKind } from '#lib/services/semantic-debt.js';

	interface Props {
		items: DebtItem[];
		settings: DebtSettings;
		onSettingsChange: (settings: DebtSettings) => void;
	}

	let { items, settings, onSettingsChange }: Props = $props();

	let kind = $state<DebtKind | ''>('');
	let search = $state('');
	/* svelte-ignore state_referenced_locally */
	let reviewPeriod = $state(String(settings.reviewPeriodMonths));
	/* svelte-ignore state_referenced_locally */
	let staleAfter = $state(String(settings.staleAfterMonths));
	let error = $state<string | null>(null);

	const shown = $derived(filterDebt(items, { kind: kind || undefined, search }));
	const kindLabel = (k: DebtKind) => DEBT_KINDS.find((d) => d.kind === k)?.label ?? k;

	function apply(event: SubmitEvent) {
		event.preventDefault();
		const next = { reviewPeriodMonths: Number(reviewPeriod), staleAfterMonths: Number(staleAfter) };
		// `parseDebtSettings` replaces a bad field with the default; a changed result means the input was bad.
		const checked = parseDebtSettings(JSON.stringify(next));
		if (checked.reviewPeriodMonths !== next.reviewPeriodMonths || checked.staleAfterMonths !== next.staleAfterMonths) {
			error = 'Both periods must be whole numbers of months, from 1 to 120';
			return;
		}
		error = null;
		onSettingsChange(next);
	}
</script>

<div class="debt">
	<form class="settings" onsubmit={apply} novalidate>
		<label>Review questions every (months)<input type="number" min="1" bind:value={reviewPeriod} /></label>
		<label>Concept stale after (months)<input type="number" min="1" bind:value={staleAfter} /></label>
		<button type="submit">Apply</button>
	</form>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<div class="filters">
		<label>
			Kind
			<select bind:value={kind}>
				<option value="">All</option>
				{#each DEBT_KINDS as k (k.kind)}
					<option value={k.kind}>{k.label}</option>
				{/each}
			</select>
		</label>
		<label>Search<input type="search" bind:value={search} /></label>
		<span class="count">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>
	</div>

	{#if items.length === 0}
		<p class="empty">No known semantic debt.</p>
	{:else if shown.length === 0}
		<p class="empty">Nothing matches.</p>
	{:else}
		<ul>
			{#each shown as item (item.kind + item.elementIri + item.detail)}
				<li>
					<span class="kind">{kindLabel(item.kind)}</span>
					{#if item.href}
						<a href={item.href}>{item.label}</a>
					{:else}
						<span>{item.label}</span>
					{/if}
					<span class="detail">{item.detail}</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.debt {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.settings,
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input,
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.35rem 0.5rem;
	}

	button {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: grid;
		grid-template-columns: 11rem minmax(8rem, 14rem) 1fr;
		gap: 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.9rem;
	}

	@media (max-width: 800px) {
		li {
			grid-template-columns: 1fr;
		}
	}

	.kind,
	.detail,
	.count,
	.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.error {
		margin: 0;
		color: var(--color-error);
		font-size: 0.85rem;
	}
</style>
