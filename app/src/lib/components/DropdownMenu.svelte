<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Toggle icon; the button itself supplies size, border and hover styling. */
		icon: Snippet;
		/** Becomes the toggle's `aria-label` and `title`. */
		label: string;
		/** Tooltip; defaults to `label`. */
		title?: string;
		/** Which toggle edge the panel is anchored to (it opens toward the opposite side). */
		align?: 'left' | 'right';
		/** Receives `close` so an entry that must outlive its own click (e.g. a retryable action) can
		 *  stop the click from bubbling to the panel and close the menu itself later. */
		children: Snippet<[() => void]>;
	}

	let { icon, label, title, align = 'right', children }: Props = $props();

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

<div class="dropdown-wrapper">
	<button
		class="dropdown-toggle"
		onclick={toggleOpen}
		aria-label={label}
		aria-haspopup="true"
		aria-expanded={isOpen}
		title={title ?? label}
	>
		{@render icon()}
	</button>

	{#if isOpen}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="dropdown-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="presentation" tabindex="-1"></div>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="dropdown-panel" class:align-left={align === 'left'} role="menu" tabindex="-1" onclick={close} onkeydown={handleKeydown}>
			{@render children(close)}
		</div>
	{/if}
</div>

<style>
	.dropdown-wrapper {
		position: relative;
	}

	.dropdown-toggle {
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

	.dropdown-toggle:hover {
		background: var(--color-hover);
		border-color: var(--color-text-muted);
	}

	.dropdown-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: transparent;
		z-index: 1000;
	}

	.dropdown-panel.align-left {
		left: 0;
		right: auto;
	}

	.dropdown-panel {
		position: absolute;
		top: calc(100% + 0.5rem);
		right: 0;
		min-width: 200px;
		max-width: calc(100vw - 1rem);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1001;
	}
</style>
