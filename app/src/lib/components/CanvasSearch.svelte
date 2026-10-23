<script lang="ts">
	import type { SearchMatch } from '$lib/services/canvas-search';

	interface Props {
		/** Matches for a query, evaluated against the nodes currently on the canvas. */
		matchesFor: (query: string) => SearchMatch[];
		/** Fires on every query change (including clearing) so the canvas can highlight matches. */
		onQueryChange: (query: string) => void;
		/** A result was picked from the list. */
		onSelect: (match: SearchMatch) => void;
	}

	let { matchesFor, onQueryChange, onSelect }: Props = $props();

	const MAX_ROWS = 20;
	let query = $state('');
	let open = $state(false);
	let inputEl = $state<HTMLInputElement | undefined>();
	/** Index into `matches` of the result last jumped to; -1 until the user jumps. */
	let activeIndex = $state(-1);
	const matches = $derived(matchesFor(query));
	const rows = $derived(matches.slice(0, MAX_ROWS));

	function setQuery(value: string) {
		query = value;
		onQueryChange(value);
	}

	function handleInput() {
		open = true;
		activeIndex = -1;
		onQueryChange(query);
	}

	function pick(match: SearchMatch) {
		setQuery(match.name);
		open = false;
		activeIndex = matchesFor(match.name).findIndex((m) => m.id === match.id);
		onSelect(match);
	}

	/** Jumps to the match `step` away from the current one (wrapping); the first jump lands on the first match. */
	function jump(step: 1 | -1) {
		if (matches.length === 0) return;
		const next =
			activeIndex < 0 ? (step === 1 ? 0 : matches.length - 1) : (activeIndex + step + matches.length) % matches.length;
		activeIndex = next;
		open = false;
		onSelect(matches[next]);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			setQuery('');
			open = false;
			activeIndex = -1;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			jump(event.shiftKey ? -1 : 1);
		}
	}

	/** `/` focuses the box unless the user is already typing somewhere. */
	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target && (target.closest('input, textarea, select') || target.isContentEditable)) return;
		event.preventDefault();
		inputEl?.focus();
	}

	const countText = $derived(
		query.trim() === ''
			? ''
			: matches.length === 0
				? 'No matches'
				: activeIndex < 0
					? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`
					: `${activeIndex + 1} of ${matches.length}`
	);
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="canvas-search">
	<input
		type="search"
		role="combobox"
		aria-expanded={open && rows.length > 0}
		aria-controls="canvas-search-results"
		placeholder="Search classes"
		autocomplete="off"
		bind:this={inputEl}
		bind:value={query}
		oninput={handleInput}
		onkeydown={handleKeydown}
		onfocus={() => (open = query.trim() !== '')}
		onblur={() => (open = false)}
	/>
	{#if countText}
		<div class="status">
			<span data-testid="canvas-search-count">{countText}</span>
			<span class="steps">
				<button type="button" aria-label="Previous match" disabled={matches.length === 0} onclick={() => jump(-1)}>↑</button>
				<button type="button" aria-label="Next match" disabled={matches.length === 0} onclick={() => jump(1)}>↓</button>
			</span>
		</div>
	{/if}
	{#if open && rows.length > 0}
		<ul id="canvas-search-results" role="listbox">
			{#each rows as match (match.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li role="option" aria-selected="false" onmousedown={(e) => e.preventDefault()} onclick={() => pick(match)}>
					{match.name}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.canvas-search {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 6;
		width: 16rem;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.3rem 0.5rem;
		font-size: 0.85rem;
	}
	.status {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 0.15rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.75rem;
		background: var(--color-surface, #fff);
		border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
		border-radius: 4px;
	}
	.steps button {
		padding: 0 0.35rem;
		cursor: pointer;
	}
	ul {
		list-style: none;
		margin: 0.15rem 0 0;
		padding: 0;
		max-height: 14rem;
		overflow-y: auto;
		background: var(--color-surface, #fff);
		color: var(--color-text, inherit);
		border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
		border-radius: 4px;
	}
	li {
		padding: 0.3rem 0.5rem;
		cursor: pointer;
		font-size: 0.85rem;
	}
	li:hover {
		background: rgba(127, 127, 127, 0.18);
	}
</style>
