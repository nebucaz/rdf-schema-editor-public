<script module lang="ts">
	import type { Snippet } from 'svelte';

	/** One entry in a per-node dropdown menu (Story 013). `icon` is a snippet so callers can reuse
	 *  their existing inline-SVG markup unchanged; `hidden` entries are omitted entirely (not shown
	 *  disabled) — matches `EntityNode`'s existing `!isAssociationClass` guard on "Manage instances". */
	export interface NodeMenuEntry {
		label: string;
		icon: Snippet;
		onClick: () => void;
		hidden?: boolean;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	interface Props {
		entries: NodeMenuEntry[];
	}

	let { entries }: Props = $props();

	let isOpen = $state(false);
	let toggleEl: HTMLButtonElement | undefined = $state();
	let panelEl: HTMLDivElement | undefined = $state();
	let panelPosition = $state<{ top: number; left: number }>({ top: 0, left: 0 });

	const visibleEntries = $derived(entries.filter((entry) => !entry.hidden));

	/** Screen-coordinate anchor for the portaled panel (data-catalog Story 021), computed from the
	 *  toggle button's own `getBoundingClientRect()` at open time — that already returns true screen
	 *  coordinates regardless of any ancestor `transform` (Svelte Flow's pan/zoom), so the panel
	 *  stays correctly anchored without needing to know about the canvas's viewport transform at
	 *  all. `left` is the button's right edge; the panel right-aligns to it via `transform:
	 *  translateX(-100%)` in CSS, so this doesn't need to know the panel's own (variable) width. */
	function updatePosition() {
		if (!toggleEl) return;
		const rect = toggleEl.getBoundingClientRect();
		panelPosition = { top: rect.bottom + 4, left: rect.right };
	}

	function toggleOpen() {
		if (!isOpen) updatePosition();
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	/** Closes on any pointerdown outside the toggle button and the (portaled) panel — replaces the
	 *  old in-DOM `.node-menu-backdrop`, which lived inside `.entity-node`'s `overflow: hidden`
	 *  subtree and so was clipped the exact same way the panel was (data-catalog Story 021): a click
	 *  far from the node could never actually reach it. This also fires at the start of a canvas
	 *  pan drag (which begins with a `pointerdown` on Svelte Flow's pane, outside the panel), so a
	 *  stale-positioned panel can't linger after the canvas moves under it. */
	function handleWindowPointerDown(event: PointerEvent) {
		const target = event.target as Node;
		if (toggleEl?.contains(target) || panelEl?.contains(target)) return;
		close();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	function activate(entry: NodeMenuEntry) {
		if (entry.disabled) return;
		close();
		entry.onClick();
	}

	/** Moves `node` to `document.body` for as long as it's mounted, escaping `.entity-node`'s
	 *  `overflow: hidden` clip (data-catalog Story 021) — `EntityNode`'s own clipping is unchanged,
	 *  still needed for its rounded-header background bleed. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<svelte:window
	onkeydown={isOpen ? handleKeydown : undefined}
	onpointerdown={isOpen ? handleWindowPointerDown : undefined}
	onwheel={isOpen ? close : undefined}
/>

<div class="node-menu">
	<button
		bind:this={toggleEl}
		class="node-menu-toggle"
		onclick={toggleOpen}
		aria-label="Node menu"
		aria-haspopup="true"
		aria-expanded={isOpen}
		title="Menu"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
			<circle cx="12" cy="5" r="1.5" />
			<circle cx="12" cy="12" r="1.5" />
			<circle cx="12" cy="19" r="1.5" />
		</svg>
	</button>

	{#if isOpen}
		<div
			bind:this={panelEl}
			use:portal
			class="node-menu-panel"
			role="menu"
			tabindex="-1"
			style={`top: ${panelPosition.top}px; left: ${panelPosition.left}px;`}
		>
			{#each visibleEntries as entry (entry.label)}
				<button
					class="node-menu-item"
					role="menuitem"
					disabled={entry.disabled}
					onclick={() => activate(entry)}
				>
					<span class="node-menu-icon">{@render entry.icon()}</span>
					<span class="node-menu-label">{entry.label}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.node-menu {
		position: relative;
	}

	.node-menu-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		border: none;
		cursor: pointer;
		opacity: 0.85;
	}

	.node-menu-toggle:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.2);
	}

	/* Portaled to `document.body` (data-catalog Story 021) — `position: fixed` with `top`/`left`
	   set inline from the toggle button's screen-space `getBoundingClientRect()`. `translateX(-100%)`
	   right-aligns the panel to that anchor without needing to know its own rendered width. */
	.node-menu-panel {
		position: fixed;
		min-width: 170px;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
		padding: 0.25rem;
		z-index: 1001;
		display: flex;
		flex-direction: column;
		transform: translateX(-100%);
	}

	.node-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}

	.node-menu-item:hover:not(:disabled) {
		background: var(--color-hover);
	}

	.node-menu-item:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.node-menu-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		color: var(--color-text-muted);
	}
</style>
