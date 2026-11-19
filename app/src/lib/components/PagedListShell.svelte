<script lang="ts">
	/** The frame every list on the Vocabulary page shares (spec/vocabulary-graph-and-tabs STORY-446): a search box
	 *  (debounced), a toolbar for the list's Add button, optional filters, the list itself, the result count and a pager.
	 *  It holds no data and no URL: the page owns `search` and `page` and receives every change through `onChange`;
	 *  a new search always asks for page 1. */
	import type { Snippet } from 'svelte';
	import { clampPage, pageCount, pageWindow } from '#lib/services/list-paging.js';

	interface Props {
		/** Plural name of what is listed, e.g. "Concepts"; names the search box and the pager for screen readers. */
		label: string;
		total: number;
		pageSize: number;
		/** 1-based. */
		page: number;
		search: string;
		onChange: (next: { search: string; page: number }) => void;
		/** Sits above the list, left of the search box: the Add button. */
		toolbar?: Snippet;
		/** Extra filters (scheme, status) beside the search box. */
		filters?: Snippet;
		/** The rows of the current page. */
		children: Snippet;
		debounceMs?: number;
	}

	let { label, total, pageSize, page, search, onChange, toolbar, filters, children, debounceMs = 300 }: Props = $props();

	let value = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Follow the page's state (back button, a link) unless the user is typing.
	$effect(() => {
		const external = search;
		if (timer === undefined) value = external;
	});

	$effect(() => () => clearTimeout(timer));

	function typed(next: string) {
		value = next;
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			onChange({ search: next, page: 1 });
		}, debounceMs);
	}

	const pages = $derived(pageCount(total, pageSize));
	const current = $derived(clampPage(page, pages));
	const numbers = $derived(pageWindow(current, pages));

	function go(next: number) {
		onChange({ search, page: clampPage(next, pages) });
	}
</script>

<section class="shell">
	<div class="bar">
		{#if toolbar}<div class="toolbar">{@render toolbar()}</div>{/if}
		<input
			type="search"
			class="search"
			placeholder="Search…"
			aria-label={`Search ${label}`}
			value={value}
			oninput={(e) => typed(e.currentTarget.value)}
		/>
		{#if filters}<div class="filters">{@render filters()}</div>{/if}
	</div>

	<p class="count" aria-live="polite">{total === 0 ? 'No results' : `${total} ${total === 1 ? 'result' : 'results'}`}</p>

	{#if total > 0}
		{@render children()}
	{/if}

	{#if pages > 1}
		<nav class="pager" aria-label={`${label} pages`}>
			<button type="button" aria-label="Previous page" disabled={current <= 1} onclick={() => go(current - 1)}>‹</button>
			{#each numbers as entry, i (entry ?? `gap-${i}`)}
				{#if entry === null}
					<span class="gap" aria-hidden="true">…</span>
				{:else}
					<button
						type="button"
						aria-label={`Page ${entry}`}
						aria-current={entry === current ? 'page' : undefined}
						class:current={entry === current}
						onclick={() => go(entry)}>{entry}</button>
				{/if}
			{/each}
			<button type="button" aria-label="Next page" disabled={current >= pages} onclick={() => go(current + 1)}>›</button>
		</nav>
	{/if}
</section>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.toolbar,
	.filters {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
	.search {
		flex: 1 1 14rem;
		min-width: 10rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
	}
	.count {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
	.pager {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		align-items: center;
		justify-content: center;
	}
	.pager button {
		min-width: 2rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		cursor: pointer;
	}
	.pager button:hover:not(:disabled) {
		background: var(--color-hover);
	}
	.pager button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.pager button.current {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
	.gap {
		padding: 0 0.25rem;
		color: var(--color-text-muted);
	}
</style>
