<script lang="ts">
	interface Props {
		/** True while requests are in flight (`requestActivity.busy`). */
		busy: boolean;
		/** True while the full-canvas overlay is already showing, so the corner stays quiet. */
		suppressed?: boolean;
		/** Busy must last this long before the indicator appears, so quick requests do not flicker. */
		delayMs?: number;
	}

	let { busy, suppressed = false, delayMs = 200 }: Props = $props();

	let elapsed = $state(false);

	$effect(() => {
		if (!busy) {
			elapsed = false;
			return;
		}
		const timer = setTimeout(() => (elapsed = true), delayMs);
		return () => clearTimeout(timer);
	});
</script>

{#if busy && elapsed && !suppressed}
	<div class="activity-indicator" role="status" aria-label="Working" data-testid="activity-indicator">
		<div class="spinner" aria-hidden="true"></div>
	</div>
{/if}

<style>
	.activity-indicator {
		position: fixed;
		right: 0.75rem;
		bottom: 0.75rem;
		z-index: 60;
		pointer-events: none;
		padding: 0.4rem;
		border-radius: 999px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		line-height: 0;
	}
	.spinner {
		width: 1rem;
		height: 1rem;
		border: 2px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
			border-top-color: var(--color-border);
			border-right-color: var(--color-accent);
		}
	}
</style>
