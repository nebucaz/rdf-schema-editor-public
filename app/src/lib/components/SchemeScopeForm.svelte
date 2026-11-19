<script lang="ts">
	/** Scope record of a concept scheme (ontology-pipeline STORY-323, book p. 22): why the vocabulary
	 *  exists and where it stops, written down before terms are collected. */
	import { emptySchemeMetadata, type SchemeMetadata } from '#lib/services/scheme-metadata.js';
	import type { ConceptScheme, SchemeScope } from '#lib/services/skos-concept.js';

	interface Props {
		scheme: ConceptScheme;
		onSave: (scope: SchemeScope) => Promise<void>;
		/** Saves the Dublin Core description; `modified` is read-only and set by the app. */
		onSaveMetadata?: (metadata: SchemeMetadata) => Promise<void>;
	}

	let { scheme, onSave, onSaveMetadata }: Props = $props();

	// The form edits a copy: `scheme` seeds it once and later prop changes do not overwrite the input.
	/* svelte-ignore state_referenced_locally */
	let purpose = $state(scheme.scope.purpose);
	/* svelte-ignore state_referenced_locally */
	let decisionsSupported = $state(scheme.scope.decisionsSupported);
	/* svelte-ignore state_referenced_locally */
	let outOfScope = $state(scheme.scope.outOfScope);
	/* svelte-ignore state_referenced_locally */
	let stakeholders = $state(scheme.scope.stakeholders);
	/* svelte-ignore state_referenced_locally */
	const meta = scheme.metadata ?? emptySchemeMetadata();
	let title = $state(meta.title);
	let creator = $state(meta.creator);
	let publisher = $state(meta.publisher);
	let rights = $state(meta.rights);
	let error = $state<string | null>(null);
	let saved = $state(false);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		saved = false;
		try {
			await onSave({
				purpose: purpose.trim(),
				decisionsSupported: decisionsSupported.trim(),
				outOfScope: outOfScope.trim(),
				stakeholders: stakeholders.trim()
			});
			await onSaveMetadata?.({
				title: title.trim(),
				creator: creator.trim(),
				publisher: publisher.trim(),
				rights: rights.trim(),
				modified: meta.modified
			});
			saved = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit}>
	<label>
		Purpose
		<textarea bind:value={purpose} rows="2" placeholder="What is this vocabulary for?"></textarea>
	</label>
	<label>
		Decisions supported
		<textarea bind:value={decisionsSupported} rows="2" placeholder="Which decisions or questions rely on it?"></textarea>
	</label>
	<label>
		Out of scope
		<textarea bind:value={outOfScope} rows="2" placeholder="What does it deliberately not cover?"></textarea>
	</label>
	<label>
		Stakeholders
		<textarea bind:value={stakeholders} rows="2" placeholder="Who owns and uses it?"></textarea>
	</label>
	<label>
		Title
		<input type="text" bind:value={title} placeholder="dct:title" />
	</label>
	<label>
		Creator
		<input type="text" bind:value={creator} placeholder="dct:creator: a name or an IRI" />
	</label>
	<label>
		Publisher
		<input type="text" bind:value={publisher} placeholder="dct:publisher: a name or an IRI" />
	</label>
	<label>
		Rights
		<input type="text" bind:value={rights} placeholder="dct:rights, e.g. CC-BY-4.0" />
	</label>
	<label>
		Last modified
		<input type="text" value={meta.modified} readonly placeholder="Set when the scheme or its concepts change" />
	</label>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	{#if saved}
		<p class="saved" role="status">Scope saved.</p>
	{/if}
	<div class="actions">
		<button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save scope'}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input,
	textarea {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.saved {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
		background: var(--color-accent);
		color: #fff;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
