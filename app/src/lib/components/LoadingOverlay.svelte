<script lang="ts">
	interface Props {
		/** Covers the parent (which must be `position: relative`) while true. */
		active: boolean;
		label?: string;
	}

	let { active, label = 'Loading workspace' }: Props = $props();
</script>

{#if active}
	<div class="loading-overlay" role="status" aria-busy="true" aria-label={label} data-testid="loading-overlay">
		<div class="spinner" aria-hidden="true"></div>
		<span class="text">{label}…</span>
	</div>
{/if}

<style>
	.loading-overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		background: color-mix(in srgb, var(--color-bg) 80%, transparent);
		color: var(--color-text);
	}
	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	.text {
		font-size: 0.9rem;
		color: var(--color-text-muted);
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
