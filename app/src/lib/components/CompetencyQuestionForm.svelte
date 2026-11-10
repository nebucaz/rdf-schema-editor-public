<script lang="ts">
	/** Add/edit form for one competency question (ontology-pipeline STORY-317). Validation is the pure
	 *  `validateCompetencyQuestion`; messages show once the user has tried to save. */
	import {
		validateCompetencyQuestion,
		type CompetencyQuestion,
		type CompetencyQuestionDraft,
		type ExpectedResult
	} from '#lib/services/competency-question.js';

	interface NamedIri {
		iri: string;
		label: string;
	}

	interface Props {
		initial?: CompetencyQuestion;
		/** Classes and properties the question can be linked to. */
		elements: NamedIri[];
		savedQueries: NamedIri[];
		onSave: (draft: CompetencyQuestionDraft) => Promise<void>;
		onCancel: () => void;
	}

	let { initial, elements, savedQueries, onSave, onCancel }: Props = $props();

	type ExpectedKey = 'rows' | 'ask-true' | 'ask-false' | 'values';

	function keyOf(e: ExpectedResult | undefined): ExpectedKey {
		if (!e || e.kind === 'minRows') return 'rows';
		if (e.kind === 'values') return 'values';
		return e.value ? 'ask-true' : 'ask-false';
	}

	// The form edits a copy: `initial` seeds it once and later prop changes do not overwrite the input.
	/* svelte-ignore state_referenced_locally */
	let question = $state(initial?.question ?? '');
	/* svelte-ignore state_referenced_locally */
	let expectedKey = $state<ExpectedKey>(keyOf(initial?.expected));
	/* svelte-ignore state_referenced_locally */
	let minRows = $state(initial?.expected.kind === 'minRows' ? String(initial.expected.count) : '1');
	/* svelte-ignore state_referenced_locally */
	let valuesText = $state(initial?.expected.kind === 'values' ? initial.expected.values.join('\n') : '');
	/* svelte-ignore state_referenced_locally */
	let sourceKind = $state<'sparql' | 'saved'>(initial?.query.kind ?? 'sparql');
	/* svelte-ignore state_referenced_locally */
	let sparqlText = $state(initial?.query.kind === 'sparql' ? initial.query.text : '');
	/* svelte-ignore state_referenced_locally */
	let savedIri = $state(initial?.query.kind === 'saved' ? initial.query.iri : '');
	/* svelte-ignore state_referenced_locally */
	let linked = $state<string[]>([...(initial?.linkedElements ?? [])]);
	/* svelte-ignore state_referenced_locally */
	let owner = $state(initial?.owner ?? '');
	/* svelte-ignore state_referenced_locally */
	let lastReviewed = $state(initial?.lastReviewed ?? '');

	let attempted = $state(false);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	const draft = $derived<CompetencyQuestionDraft>({
		question: question.trim(),
		expected:
			expectedKey === 'rows'
				? { kind: 'minRows', count: Number(minRows) }
				: expectedKey === 'values'
					? { kind: 'values', values: valuesText.split('\n').map((v) => v.trim()).filter(Boolean) }
					: { kind: 'ask', value: expectedKey === 'ask-true' },
		query: sourceKind === 'saved' ? { kind: 'saved', iri: savedIri } : { kind: 'sparql', text: sparqlText },
		linkedElements: linked,
		owner: owner.trim(),
		lastReviewed
	});
	const errors = $derived(validateCompetencyQuestion(draft));

	function toggle(iri: string) {
		linked = linked.includes(iri) ? linked.filter((i) => i !== iri) : [...linked, iri];
	}

	async function submit(event: Event) {
		event.preventDefault();
		attempted = true;
		saveError = null;
		if (errors.length > 0 || saving) return;
		saving = true;
		try {
			await onSave(draft);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Failed to save the question';
		} finally {
			saving = false;
		}
	}
</script>

<form class="cq-form" novalidate onsubmit={submit} data-testid="competency-question-form">
	<label>
		Question
		<textarea rows="2" bind:value={question}></textarea>
	</label>

	<label>
		Expected result
		<select bind:value={expectedKey}>
			<option value="rows">At least N rows</option>
			<option value="ask-true">ASK is true</option>
			<option value="ask-false">ASK is false</option>
			<option value="values">Rows contain these values</option>
		</select>
	</label>
	{#if expectedKey === 'rows'}
		<label>
			Minimum rows
			<input type="number" min="1" step="1" bind:value={minRows} />
		</label>
	{:else if expectedKey === 'values'}
		<label>
			Expected values (one per line)
			<textarea rows="3" bind:value={valuesText}></textarea>
		</label>
	{/if}

	<label>
		Query source
		<select bind:value={sourceKind}>
			<option value="sparql">Own SPARQL</option>
			<option value="saved">Saved query</option>
		</select>
	</label>
	{#if sourceKind === 'sparql'}
		<label>
			SPARQL query
			<textarea rows="5" class="mono" bind:value={sparqlText}></textarea>
		</label>
	{:else}
		<label>
			Saved query
			<select bind:value={savedIri}>
				<option value="">Choose…</option>
				{#each savedQueries as sq (sq.iri)}
					<option value={sq.iri}>{sq.label}</option>
				{/each}
			</select>
		</label>
	{/if}

	<fieldset>
		<legend>Linked classes and properties</legend>
		<div class="elements">
			{#each elements as el (el.iri)}
				<label class="check">
					<input type="checkbox" checked={linked.includes(el.iri)} onchange={() => toggle(el.iri)} />
					{el.label}
				</label>
			{/each}
		</div>
	</fieldset>

	<label>
		Owner
		<input bind:value={owner} />
	</label>
	<label>
		Last reviewed
		<input type="date" bind:value={lastReviewed} />
	</label>

	{#if attempted && errors.length > 0}
		<ul class="errors" data-testid="cq-errors">
			{#each errors as message (message)}
				<li>{message}</li>
			{/each}
		</ul>
	{/if}
	{#if saveError}
		<p class="errors" role="alert">{saveError}</p>
	{/if}

	<div class="buttons">
		<button type="button" onclick={onCancel}>Cancel</button>
		<button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	.cq-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	input,
	textarea,
	select {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}
	.mono {
		font-family: monospace;
	}
	fieldset {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.elements {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0.25rem;
		max-height: 10rem;
		overflow-y: auto;
	}
	.check {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}
	.errors {
		margin: 0;
		padding-left: 1.2rem;
		color: var(--color-error);
		font-size: 0.85rem;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
