<script lang="ts">
	/** Content of the "Promote to class" dialog (ontology-pipeline STORY-326); hosted in a `Modal` by the
	 *  Vocabulary page. Choose the namespace the new class goes into. */
	import { promoteGuidance } from '#lib/services/concept-to-class.js';
	import type { Concept } from '#lib/services/skos-concept.js';
	import type { FetchedNamespace } from '#lib/services/sparql-connector.js';

	interface Props {
		conceptTitle: string;
		/** When given, the dialog shows the keep-or-promote guidance for it. */
		concept?: Concept;
		namespaces: FetchedNamespace[];
		onConfirm: (namespaceBaseIri: string) => Promise<void>;
		onCancel: () => void;
	}

	let { conceptTitle, concept, namespaces, onConfirm, onCancel }: Props = $props();

	const guidance = $derived(concept ? promoteGuidance(concept) : null);

	// Terms live in the vocabulary namespace; classes go anywhere else.
	const options = $derived(namespaces.filter((n) => !n.vocabulary));
	let chosen = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (!options.some((n) => n.baseIri === chosen)) chosen = options[0]?.baseIri ?? '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			await onConfirm(chosen);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<p>
		Create a class from <strong>{conceptTitle}</strong>. The class takes its name from the preferred label and is linked
		to the concept; the definition stays in the vocabulary and is not copied.
	</p>
	{#if guidance}
		<section class="guidance" aria-label="Keep as concept or promote?">
			<h4>Keep it as a concept, or promote it?</h4>
			<p>Keep it as a concept when:</p>
			<ul>
				{#each guidance.stay as item (item)}<li>{item}</li>{/each}
			</ul>
			<p>Promote it to a class when:</p>
			<ul>
				{#each guidance.promote as item (item)}<li>{item}</li>{/each}
			</ul>
			<p class="example">Example: {guidance.example}</p>
			{#if guidance.lean}
				<p role="note" class="lean">
					{guidance.lean === 'keep'
						? 'Going by its name, this looks like a term that can stay a concept. Promote it only if it needs something from the second list.'
						: 'Going by its definition, this term has structure a class could carry. Promoting it is reasonable.'}
				</p>
			{/if}
			<p class="advice">This is advice only; you can promote either way.</p>
		</section>
	{/if}
	<label>
		Namespace
		<select bind:value={chosen} disabled={options.length === 0}>
			{#each options as ns (ns.baseIri)}
				<option value={ns.baseIri}>{ns.prefix || ns.baseIri}</option>
			{/each}
		</select>
	</label>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy || !chosen}>Promote</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	p {
		margin: 0;
		font-size: 0.9rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.guidance {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.guidance h4,
	.guidance ul {
		margin: 0;
	}

	.guidance ul {
		padding-left: 1.2rem;
		font-size: 0.85rem;
	}

	.example,
	.advice {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.lean {
		color: var(--color-warning);
	}

	.error {
		color: var(--color-error);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
