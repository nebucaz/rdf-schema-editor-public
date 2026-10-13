<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		isOpen: boolean;
		title: string;
		onClose: () => void;
		children: Snippet;
		/** Overrides the default 500px content width — e.g. the Query Console needs room for a
		 *  results table (`ResultsTable.svelte`), which most modal content here doesn't. */
		maxWidth?: string;
		/** Whether a backdrop click or Escape can dismiss the dialog, in addition to its own close
		 *  button/Cancel action. Defaults to `true` (the existing behavior everywhere else). Set
		 *  `false` for a dialog that can hold not-yet-saved input (e.g. the Query Console's inline
		 *  "Save as…" form) — an accidental click outside it, or an Escape reaching it while typing,
		 *  would otherwise silently discard whatever's been entered so far. The explicit close
		 *  button (always rendered) and any in-content Cancel button still work either way, since
		 *  both call `onClose` directly rather than going through this gate. */
		dismissible?: boolean;
	}

	let { isOpen, title, onClose, children, maxWidth = '500px', dismissible = true }: Props = $props();

	let dialogEl = $state<HTMLDivElement | undefined>();

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	// Focus moves into the dialog on open and returns to the opener on close; Tab stays inside.
	$effect(() => {
		if (!isOpen || !dialogEl) return;
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		if (!dialogEl.contains(document.activeElement)) {
			dialogEl.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		}
		return () => {
			if (opener?.isConnected) opener.focus();
		};
	});

	function trapTab(event: KeyboardEvent) {
		if (event.key !== 'Tab' || event.defaultPrevented || !dialogEl) return;
		const items = [...dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || !dialogEl.contains(active))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || !dialogEl.contains(active))) {
			event.preventDefault();
			first.focus();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (dismissible && event.target === event.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		trapTab(event);
		if (dismissible && event.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1">
		<div class="modal-content" style:max-width={maxWidth} bind:this={dialogEl}>
			<div class="modal-header">
				<h2 id="modal-title">{title}</h2>
				<button class="close-button" onclick={onClose} aria-label="Close">
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M18 6 6 18"/>
						<path d="m6 6 12 12"/>
					</svg>
				</button>
			</div>
			<div class="modal-body">
				{@render children()}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1002;
		padding: 1rem;
	}

	.modal-content {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		width: 100%;
		max-width: 500px;
		max-height: 90vh;
		overflow: auto;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid var(--color-border);
	}

	.modal-header h2 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
	}

	.close-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		min-height: 32px;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		cursor: pointer;
		transition: background var(--transition), color var(--transition);
	}

	.close-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.modal-body {
		padding: 1.5rem;
	}
</style>
