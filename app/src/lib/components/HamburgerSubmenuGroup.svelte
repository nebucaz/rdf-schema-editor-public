<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte';
	import { getHamburgerSubmenuCoordinator } from './hamburger-submenu-context.svelte';

	interface Props {
		label: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();

	const id = $props.id();
	const coordinator = getHamburgerSubmenuCoordinator();
	const isOpen = $derived(coordinator.openId === id);

	let toggleEl: HTMLButtonElement | undefined = $state();
	let panelPosition = $state<{ top: number; right: number }>({ top: 0, right: 0 });

	/** Grace period between leaving the toggle row and entering the flyout (they aren't adjacent —
	 *  the flyout opens to the left, per the positioning below) — without it, the panel would close
	 *  the instant the pointer leaves the row while crossing the gap toward the panel itself. */
	const CLOSE_DELAY_MS = 200;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	function cancelClose() {
		if (closeTimer !== undefined) {
			clearTimeout(closeTimer);
			closeTimer = undefined;
		}
	}

	/** Anchors the flyout to open toward the left of the trigger row (plan.md's Risk Assessment —
	 *  `.hamburger-panel` is right-aligned, so a right-opening flyout would have less room), mirroring
	 *  `NodeMenu.svelte`'s `getBoundingClientRect()`-based positioning minus the portal: neither of
	 *  `NodeMenu`'s clipping/transform constraints apply to `.hamburger-panel`. */
	function updatePosition() {
		if (!toggleEl) return;
		const rect = toggleEl.getBoundingClientRect();
		panelPosition = { top: rect.top, right: window.innerWidth - rect.left + 4 };
	}

	function open() {
		cancelClose();
		updatePosition();
		coordinator.setOpenId(id);
	}

	function scheduleClose() {
		cancelClose();
		closeTimer = setTimeout(() => {
			closeTimer = undefined;
			if (coordinator.openId === id) coordinator.setOpenId(null);
		}, CLOSE_DELAY_MS);
	}

	onDestroy(cancelClose);
</script>

<!-- `focusin`/`focusout` (unlike `focus`/`blur`) bubble, so tabbing from the toggle into a leaf
     entry inside the flyout — a DOM descendant of this wrapper regardless of the panel's `position:
     fixed` visual placement — keeps the group open instead of blurring the toggle and closing under
     the keyboard-focused item. -->
<div class="submenu-group" onfocusin={cancelClose} onfocusout={scheduleClose}>
	<button
		bind:this={toggleEl}
		type="button"
		class="submenu-toggle"
		onmouseenter={open}
		onmouseleave={scheduleClose}
		onfocus={open}
		aria-haspopup="true"
		aria-expanded={isOpen}
	>
		<span>{label}</span>
		<span class="submenu-chevron" aria-hidden="true">▸</span>
	</button>

	{#if isOpen}
		<div
			class="submenu-panel"
			role="menu"
			tabindex="-1"
			style={`top: ${panelPosition.top}px; right: ${panelPosition.right}px;`}
			onmouseenter={cancelClose}
			onmouseleave={scheduleClose}
		>
			{@render children()}
		</div>
	{/if}
</div>

<style>
	.submenu-group {
		position: relative;
	}

	.submenu-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		text-align: left;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.875rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.submenu-toggle:hover {
		background: var(--color-hover);
	}

	.submenu-chevron {
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	/* position: fixed, not portaled — `.hamburger-panel` is neither clipped nor inside a transformed
	   ancestor, so screen-space coordinates from `getBoundingClientRect()` are enough (see
	   `updatePosition` above). */
	.submenu-panel {
		position: fixed;
		min-width: 200px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.5rem;
		z-index: 1002;
	}
</style>
