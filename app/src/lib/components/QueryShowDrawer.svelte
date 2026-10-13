<script lang="ts">
	/**
	 * STORY-193: read-only "Show query" drawer — SPL pipeline and generated SPARQL tabs, a copy button
	 *. Derived from the current model, so it updates as the model changes; an invalid model
	 * shows its validation messages instead of output. Read-only: there is no hand-off to the console,
	 * as edits made there could never flow back into the model.
	 */
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { QueryModel } from '$lib/services/query-model';
	import { describeQueryOutput } from '$lib/services/query-preview';

	interface Props {
		model: QueryModel;
		schema: BuilderSchema;
	}

	let { model, schema }: Props = $props();

	let open = $state(false);
	let tab = $state<'spl' | 'sparql'>('spl');
	let copied = $state<'ok' | 'failed' | null>(null);
	const output = $derived(describeQueryOutput(model, schema));

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = 'ok';
		} catch {
			copied = 'failed';
		}
		setTimeout(() => (copied = null), 2000);
	}
</script>

<div class="drawer group">
	<button type="button" aria-expanded={open} onclick={() => (open = !open)}>
		{open ? 'Hide query' : 'Show query'}
	</button>

	{#if open}
		<div class="panel" data-testid="show-query">
			{#if !output.ok}
				<ul class="messages" role="status" data-testid="show-query-issues">
					{#each output.messages as message (message)}<li>{message}</li>{/each}
				</ul>
			{:else}
				<div class="tabs" role="tablist">
					<button type="button" role="tab" aria-selected={tab === 'spl'} onclick={() => (tab = 'spl')}>SPL</button>
					<button type="button" role="tab" aria-selected={tab === 'sparql'} onclick={() => (tab = 'sparql')}>SPARQL</button>
				</div>
				{#if tab === 'spl'}
					<pre data-testid="show-query-spl">{output.spl}</pre>
				{:else}
					<pre data-testid="show-query-sparql">{output.sparql}</pre>
					<div class="actions">
						<button type="button" onclick={() => copy(output.sparql)}>Copy</button>
						{#if copied === 'ok'}<span>Copied</span>{/if}
						{#if copied === 'failed'}<span class="error" role="alert">Copy failed — select the text and copy manually.</span>{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.drawer {
		margin: 0.5rem 0;
	}
	.panel {
		margin-top: 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.75rem;
	}
	.tabs {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}
	.tabs [aria-selected='true'] {
		font-weight: 600;
		text-decoration: underline;
	}
	pre {
		margin: 0;
		overflow: auto;
		max-height: 40vh;
		font-size: 0.8rem;
		white-space: pre-wrap;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.messages {
		margin: 0;
		padding-left: 1.25rem;
		color: var(--color-danger, #b00020);
	}
	.error {
		color: var(--color-danger, #b00020);
	}
</style>
