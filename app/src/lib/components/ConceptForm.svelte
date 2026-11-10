<script lang="ts">
	/** Add/edit form for one SKOS concept (ontology-pipeline STORY-323). Validation is the pure
	 *  `validateConceptDraft`; while the preferred label is typed, `findSimilarConcepts` suggests an
	 *  existing concept and offers to record the typed term as its alternative label instead. */
	import RationaleField from './RationaleField.svelte';
	import {
		conceptTitle,
		findSimilarConcepts,
		validateConceptDraft,
		type Concept,
		type ConceptDraft,
		type ConceptScheme,
		type LangText
	} from '#lib/services/skos-concept.js';

	interface Props {
		initial?: Concept;
		schemes: ConceptScheme[];
		/** Concepts already in the vocabulary, for the duplicate check. */
		existing: Concept[];
		onSave: (draft: ConceptDraft) => Promise<void>;
		onCancel: () => void;
		onAddAlternative: (conceptIri: string, text: string, lang: string) => Promise<void>;
		/** Why the change is made; the page writes it to the change log. */
		rationale?: string;
	}

	let { initial, schemes, existing, onSave, onCancel, onAddAlternative, rationale = $bindable('') }: Props = $props();

	const linesOf = (labels: LangText[]) => labels.map((l) => l.text).join('\n');

	// The form edits a copy: `initial` seeds it once and later prop changes do not overwrite the input.
	/* svelte-ignore state_referenced_locally */
	let prefText = $state(initial?.prefLabels[0]?.text ?? '');
	/* svelte-ignore state_referenced_locally */
	let lang = $state(initial?.prefLabels[0]?.lang || 'en');
	/* svelte-ignore state_referenced_locally */
	let altText = $state(linesOf(initial?.altLabels ?? []));
	/* svelte-ignore state_referenced_locally */
	let hiddenText = $state(linesOf(initial?.hiddenLabels ?? []));
	/* svelte-ignore state_referenced_locally */
	let definition = $state(initial?.definition ?? '');
	/* svelte-ignore state_referenced_locally */
	let scopeNote = $state(initial?.scopeNote ?? '');
	/* svelte-ignore state_referenced_locally */
	let disambiguation = $state(initial?.disambiguation ?? '');
	/* svelte-ignore state_referenced_locally */
	let schemeIri = $state(initial?.schemeIri ?? '');
	/* svelte-ignore state_referenced_locally */
	let topConcept = $state(initial?.topConcept ?? false);
	/* svelte-ignore state_referenced_locally */
	let source = $state(initial?.source ?? '');
	/* svelte-ignore state_referenced_locally */
	let authority = $state(initial?.authority ?? '');

	let errors = $state<string[]>([]);
	let saveError = $state<string | null>(null);
	let busy = $state(false);

	const similar = $derived(findSimilarConcepts(prefText, existing, { ignoreIri: initial?.iri }));
	const byIri = $derived(new Map(existing.map((c) => [c.iri, c])));

	function parseLines(text: string): LangText[] {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((t) => ({ text: t, lang: lang.trim() }));
	}

	function toDraft(): ConceptDraft {
		const mainPref = prefText.trim() ? [{ text: prefText.trim(), lang: lang.trim() }] : [];
		return {
			prefLabels: [...mainPref, ...(initial?.prefLabels.slice(1) ?? [])],
			altLabels: parseLines(altText),
			hiddenLabels: parseLines(hiddenText),
			definition: definition.trim(),
			scopeNote: scopeNote.trim(),
			disambiguation: disambiguation.trim(),
			schemeIri,
			topConcept,
			status: initial?.status ?? 'proposed',
			source: source.trim(),
			authority: authority.trim(),
			replacedBy: initial?.replacedBy ?? '',
			deprecationReason: initial?.deprecationReason ?? ''
		};
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const draft = toDraft();
		errors = validateConceptDraft(draft);
		saveError = null;
		if (errors.length) return;
		busy = true;
		try {
			await onSave(draft);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	async function addAsAlternative(iri: string) {
		busy = true;
		saveError = null;
		try {
			await onAddAlternative(iri, prefText.trim(), lang.trim());
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<label>
		Preferred label
		<input type="text" bind:value={prefText} placeholder="e.g. Customer" />
	</label>
	{#if similar.length}
		<div class="similar" role="status">
			<p>Similar concept{similar.length > 1 ? 's' : ''} already in the vocabulary. Reuse {similar.length > 1 ? 'one' : 'it'} instead of adding a duplicate:</p>
			<ul>
				{#each similar as match (match.iri)}
					<li>
						<strong>{byIri.get(match.iri) ? conceptTitle(byIri.get(match.iri)!) : match.iri}</strong>
						<span class="hint">{match.match} {match.via} label "{match.label}"</span>
						{#if prefText.trim()}
							<button type="button" class="link" disabled={busy} onclick={() => addAsAlternative(match.iri)}>Add as alternative label</button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	<label>
		Language
		<input type="text" bind:value={lang} placeholder="en" size="5" />
	</label>
	<label>
		Disambiguation
		<input type="text" bind:value={disambiguation} placeholder="Only for homonyms, e.g. finance" />
	</label>
	<label>
		Alternative labels (one per line)
		<textarea bind:value={altText} rows="2" placeholder="Synonyms, abbreviations"></textarea>
	</label>
	<label>
		Hidden labels (one per line)
		<textarea bind:value={hiddenText} rows="2" placeholder="Misspellings and retired terms, found by search but not shown"></textarea>
	</label>
	<div class="field">
		<label>
			Definition
			<textarea bind:value={definition} rows="3"></textarea>
		</label>
		<span class="hint">Say what kind of thing it is, then what sets it apart (genus and differentia): "A party (genus) that buys goods or services (differentia)."</span>
	</div>
	<div class="field">
		<label>
			Scope note
			<textarea bind:value={scopeNote} rows="2"></textarea>
		</label>
		{#if disambiguation.trim() && !scopeNote.trim()}
			<span class="hint prompt">Add a scope note that tells this meaning apart from the other meanings of the term.</span>
		{/if}
	</div>
	<label>
		Scheme
		<select bind:value={schemeIri}>
			<option value="">(none)</option>
			{#each schemes as scheme (scheme.iri)}
				<option value={scheme.iri}>{scheme.name}</option>
			{/each}
		</select>
	</label>
	<label class="checkbox-label">
		<input type="checkbox" bind:checked={topConcept} />
		Top concept
	</label>
	<label>
		Source
		<input type="text" bind:value={source} placeholder="Where the definition comes from" />
	</label>
	<label>
		Authority
		<input type="text" bind:value={authority} placeholder="Who is accountable for the meaning" />
	</label>

	{#each errors as message (message)}
		<p class="error" role="alert">{message}</p>
	{/each}
	<RationaleField bind:value={rationale} />
	{#if saveError}
		<p class="error" role="alert">{saveError}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input[type='text'],
	textarea,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.hint {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.prompt {
		color: var(--color-accent);
	}

	.similar {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		font-size: 0.85rem;
	}

	.similar ul {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.link {
		background: none;
		border: none;
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
		margin-left: 0.5rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
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
