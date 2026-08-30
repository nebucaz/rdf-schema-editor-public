<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	let isOpen = $state(false);

	function toggleOpen() {
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			close();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			close();
		}
	}
</script>

<svelte:window onkeydown={isOpen ? handleKeydown : undefined} />

<div class="hamburger-wrapper">
	<button
		class="hamburger-toggle"
		onclick={toggleOpen}
		aria-label="Menu"
		aria-haspopup="true"
		aria-expanded={isOpen}
		title="Menu"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M3 6h18" />
			<path d="M3 12h18" />
			<path d="M3 18h18" />
		</svg>
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="hamburger-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="presentation" tabindex="-1"></div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="hamburger-panel" role="menu" tabindex="-1" onclick={close} onkeydown={handleKeydown}>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.hamburger-wrapper {
		position: relative;
	}

	.hamburger-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 36px;
		min-height: 36px;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text);
		border: 1px solid var(--color-border);
		cursor: pointer;
		transition: background var(--transition), border-color var(--transition);
	}

	.hamburger-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}

	.hamburger-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: transparent;
		z-index: 1000;
	}

	.hamburger-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 200px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1001;
	}
</style>
