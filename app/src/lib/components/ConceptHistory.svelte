<script lang="ts">
	/** The generated history of one concept (STORY-407, `skos:historyNote`): who changed it, when and in which
	 *  version, read from the change log. Presentational and read-only; nothing here is stored. */
	import type { HistoryNote } from '#lib/services/change-log.js';

	interface Props {
		history: HistoryNote[];
	}

	let { history }: Props = $props();
</script>

<section class="history">
	<h3>History</h3>
	{#if history.length === 0}
		<p class="hint">No changes logged for this concept yet.</p>
	{:else}
		<ul>
			{#each history as h, i (h.changedAt + i)}
				<li>
					<span>{h.summary}</span>
					<span class="hint">{h.changedBy} · {h.changedAt.slice(0, 10)}{#if h.version} · v{h.version}{/if}</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	li {
		display: flex;
		flex-direction: column;
	}
	.hint {
		color: var(--color-text-muted, inherit);
		font-size: 0.85em;
	}
</style>
