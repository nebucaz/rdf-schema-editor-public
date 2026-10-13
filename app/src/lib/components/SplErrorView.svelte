<script lang="ts">
	/**
	 * Inline SPL error (spl-input STORY-221): message, the offending line with a caret under the
	 * range, suggestions, and — for "not supported" constructs — a pointer into the in-app docs.
	 * Presentational; the formatting itself is the unit-tested `formatSplError`.
	 */
	import type { FormattedSplError } from '$lib/services/spl-error-format';

	interface Props {
		error: FormattedSplError;
		/** Called with the docs section id when the user asks for the help topic. */
		onOpenHelp?: (topic: string) => void;
	}

	let { error, onOpenHelp }: Props = $props();
</script>

<div class="spl-error" role="alert" data-testid="spl-error">
	<p class="message">
		{error.message}
		<span class="where">(line {error.line}, column {error.column})</span>
	</p>
	<pre class="source" aria-hidden="true">{error.lineText}
{error.marker}</pre>
	{#if error.suggestions.length > 0}
		<p class="suggestions" data-testid="spl-error-suggestions">
			Did you mean: {error.suggestions.join(', ')}
		</p>
	{/if}
	{#if error.helpTopic && onOpenHelp}
		<button type="button" class="help" onclick={() => onOpenHelp?.(error.helpTopic!)}>
			What SPL is supported?
		</button>
	{/if}
</div>

<style>
	.spl-error {
		color: var(--color-danger, #b00020);
	}

	.message,
	.suggestions {
		margin: 0 0 0.25rem;
	}

	.where {
		opacity: 0.75;
		font-size: 0.85em;
	}

	.source {
		margin: 0 0 0.25rem;
		padding: 0.25rem 0.5rem;
		overflow-x: auto;
		font-family: monospace;
		background: var(--color-bg-primary, transparent);
		border-left: 3px solid currentColor;
	}
</style>
