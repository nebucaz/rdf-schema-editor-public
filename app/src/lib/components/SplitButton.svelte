<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		/** Text of the main action. */
		label: string;
		/** Accessible name of the chevron that opens the menu. */
		menuLabel: string;
		onMain: () => void;
		items: { label: string; onSelect: () => void }[];
	}

	let { label, menuLabel, onMain, items }: Props = $props();

	let open = $state(false);
	let rootEl = $state<HTMLDivElement | undefined>();
	let chevronEl = $state<HTMLButtonElement | undefined>();
	let menuEl = $state<HTMLDivElement | undefined>();

	function menuItems(): HTMLElement[] {
		return menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
	}

	async function openMenu(focusFirst: boolean) {
		open = true;
		if (focusFirst) {
			await tick();
			menuItems()[0]?.focus();
		}
	}

	function close(returnFocus = true) {
		open = false;
		if (returnFocus) chevronEl?.focus();
	}

	function select(item: { onSelect: () => void }) {
		close();
		item.onSelect();
	}

	function onChevronKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			void openMenu(true);
		} else if (event.key === 'Escape' && open) {
			close();
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const all = menuItems();
		const index = all.indexOf(document.activeElement as HTMLElement);
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			all[(index + 1) % all.length]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			all[(index - 1 + all.length) % all.length]?.focus();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		} else if (event.key === 'Tab') {
			close(false);
		}
	}

	function onOutsidePointerDown(event: PointerEvent) {
		if (open && rootEl && !rootEl.contains(event.target as Node)) close(false);
	}
</script>

<svelte:document onpointerdown={onOutsidePointerDown} />

<div class="split" bind:this={rootEl}>
	<button type="button" class="main" onclick={onMain}>{label}</button>
	<button
		type="button"
		class="chevron"
		bind:this={chevronEl}
		aria-label={menuLabel}
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open ? close() : void openMenu(false))}
		onkeydown={onChevronKeydown}
	>
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="m6 9 6 6 6-6" />
		</svg>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="menu" role="menu" bind:this={menuEl} onkeydown={onMenuKeydown}>
			{#each items as item (item.label)}
				<button type="button" role="menuitem" tabindex="-1" onclick={() => select(item)}>{item.label}</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.split {
		position: relative;
		display: inline-flex;
	}
	.main,
	.chevron {
		background: var(--color-accent);
		color: #fff;
		font-size: 0.85rem;
		white-space: nowrap;
		border: none;
		cursor: pointer;
	}
	.main {
		padding: 0.4rem 0.9rem;
		border-radius: 6px 0 0 6px;
	}
	.chevron {
		display: inline-flex;
		align-items: center;
		padding: 0.4rem 0.45rem;
		border-radius: 0 6px 6px 0;
		border-left: 1px solid color-mix(in srgb, #fff 35%, transparent);
	}
	.main:hover,
	.chevron:hover,
	.chevron[aria-expanded='true'] {
		background: var(--color-accent-hover);
	}
	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 40;
		min-width: 100%;
		display: flex;
		flex-direction: column;
		padding: 0.25rem;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
	}
	.menu button {
		text-align: left;
		padding: 0.4rem 0.7rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--color-text);
		font-size: 0.85rem;
		white-space: nowrap;
		cursor: pointer;
	}
	.menu button:hover,
	.menu button:focus-visible {
		background: var(--color-hover);
		outline: none;
	}
</style>
