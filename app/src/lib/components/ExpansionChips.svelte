<script lang="ts">
	/** "Also searching for: …" under the workbench search (skos-support STORY-426): the thesaurus terms added to the
	 *  query as chips the reader can switch off, plus the narrower/broader switches. Hidden labels widen the search but
	 *  are never rendered here. */
	import { MAX_EXPANSION_TERMS, type Expansion } from '#lib/services/query-expansion.js';

	interface Props {
		expansion: Expansion;
		switchedOff: ReadonlySet<string>;
		narrower: boolean;
		broader: boolean;
		onToggleTerm: (key: string) => void;
		onOptions: (options: { narrower: boolean; broader: boolean }) => void;
	}

	let { expansion, switchedOff, narrower, broader, onToggleTerm, onOptions }: Props = $props();
</script>

{#if expansion.chips.length > 0 || expansion.hiddenTerms.length > 0}
	<div class="expansion" data-testid="search-expansion">
		{#if expansion.chips.length > 0}
			<span class="hint">Also searching for:</span>
			{#each expansion.chips as chip (chip.key)}
				<button type="button" class="chip" aria-pressed={!switchedOff.has(chip.key)} onclick={() => onToggleTerm(chip.key)}>{chip.term}</button>
			{/each}
		{/if}
		<label><input type="checkbox" checked={narrower} onchange={() => onOptions({ narrower: !narrower, broader })} /> Include narrower terms</label>
		<label><input type="checkbox" checked={broader} onchange={() => onOptions({ narrower, broader: !broader })} /> Include broader terms</label>
		{#if expansion.truncated}<span class="hint">Only the first {MAX_EXPANSION_TERMS} terms are searched.</span>{/if}
	</div>
{/if}

<style>
	.expansion {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
		margin-top: 0.4rem;
		font-size: 0.9rem;
	}

	.hint {
		color: var(--color-text-muted);
	}

	.chip {
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: none;
		padding: 0 0.6rem;
		cursor: pointer;
		font: inherit;
	}

	.chip[aria-pressed='false'] {
		text-decoration: line-through;
		opacity: 0.6;
	}
</style>
