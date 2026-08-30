<script lang="ts">
	import { PRESET_COLORS } from '$lib/utils/color-palette';

	interface Props {
		color: string | undefined;
		onChange: (color: string | undefined) => void;
		disabled?: boolean;
		/** Swatch set to render — defaults to `PRESET_COLORS` (DB32); a Note (STORY-083) passes
		 *  `NOTE_PASTEL_COLORS` instead so it reads as a post-it, not a coincidentally-light entity. */
		colors?: string[];
		/** Whether to show the "Reset to default" link — meaningful for an entity (falls back to the
		 *  namespace/theme default) but not for a Note (STORY-083): a post-it always has *some*
		 *  color, there's no "default" to reset to. */
		allowReset?: boolean;
	}

	let { color, onChange, disabled = false, colors = PRESET_COLORS, allowReset = true }: Props = $props();
</script>

<div class="color-swatches" role="group" aria-label="Node color" aria-disabled={disabled}>
	{#each colors as swatch (swatch)}
		<button
			type="button"
			class="swatch"
			class:selected={color === swatch}
			style={`background-color: ${swatch}`}
			aria-pressed={color === swatch}
			aria-label={swatch}
			title={swatch}
			{disabled}
			onclick={() => onChange(swatch)}
		></button>
	{/each}
</div>
{#if color && allowReset}
	<button type="button" class="link-button" {disabled} onclick={() => onChange(undefined)}>
		Reset to default
	</button>
{/if}

<style>
	.color-swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.swatch {
		width: 18px;
		height: 18px;
		flex: 0 0 auto;
		border-radius: 4px;
		border: 1px solid var(--color-border);
		padding: 0;
	}

	.swatch:hover {
		border-color: var(--color-text-muted);
	}

	.swatch.selected {
		border-color: var(--color-accent);
		box-shadow: 0 0 0 1px var(--color-accent-hover);
	}

	.swatch:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.link-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
		text-decoration: none;
	}

	.link-button {
		background: transparent;
		border: none;
		color: var(--color-accent);
		font-size: 0.85rem;
		padding: 0;
		margin-top: 0.4rem;
	}

	.link-button:hover {
		text-decoration: underline;
	}
</style>
