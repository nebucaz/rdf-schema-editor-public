<script lang="ts">
	interface TargetOption {
		iri: string;
		name: string;
	}

	interface GenericRelationOption {
		iri: string;
		label: string;
	}

	type RelationKind = 'specific' | 'generic';

	interface Props {
		initialName?: string;
		initialRequired?: boolean;
		initialRepeatable?: boolean;
		targetIri: string;
		targetOptions: TargetOption[];
		allowRetarget: boolean;
		submitLabel: string;
		/** STORY-053: offer the specific/generic choice at all — false for attributed-relationship
		 *  links, which always stay specific `owl:ObjectProperty`s per association-class link. */
		allowGeneric?: boolean;
		/** Existing generic relations in the current namespace, for the "reuse an existing one"
		 *  autocomplete (STORY-051's `listGenericObjectProperties`). Ignored when `allowGeneric` is
		 *  false. */
		genericRelationOptions?: GenericRelationOption[];
		/** The relation's current kind when editing — fixed (not user-editable) once created, since
		 *  switching kinds isn't supported. Defaults to 'specific' when creating. */
		initialKind?: RelationKind;
		onSubmit: (
			name: string,
			targetIri: string,
			required: boolean,
			repeatable: boolean,
			kind: RelationKind
		) => Promise<void>;
		onCancel: () => void;
	}

	let {
		initialName = '',
		initialRequired = false,
		initialRepeatable = false,
		targetIri,
		targetOptions,
		allowRetarget,
		submitLabel,
		allowGeneric = false,
		genericRelationOptions = [],
		initialKind = 'specific',
		onSubmit,
		onCancel
	}: Props = $props();

	let name = $state(initialName);
	let selectedTarget = $state(targetIri);
	let required = $state(initialRequired);
	let repeatable = $state(initialRepeatable);
	let kind = $state<RelationKind>(initialKind);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	// The kind choice is only meaningful — and only shown — when creating; an existing relation's
	// kind can't be switched after the fact (generic vs. specific changes how domain/range and
	// sh:property are stored, see STORY-052).
	const kindEditable = $derived(allowGeneric && !allowRetarget);

	const targetName = $derived(targetOptions.find((t) => t.iri === targetIri)?.name ?? targetIri);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name must not be empty';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit(name.trim(), selectedTarget, required, repeatable, kind);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	{#if allowGeneric}
		<fieldset class="kind-choice" disabled={!kindEditable}>
			<legend>Relation kind</legend>
			<label class="radio">
				<input type="radio" name="kind" value="specific" bind:group={kind} />
				Specific — new relation for this pair of entities
			</label>
			<label class="radio">
				<input type="radio" name="kind" value="generic" bind:group={kind} />
				Generic — reusable across any pair of entities, no rdfs:domain/rdfs:range
			</label>
		</fieldset>
	{/if}
	<label>
		Name
		<!--
			A single, stable input element regardless of kind/loading state (STORY-053 follow-up fix):
			`genericRelationOptions` loads asynchronously right as the dialog opens, so gating which
			`<input>` renders on `genericRelationOptions.length > 0` used to swap in a whole new DOM
			element — with a fresh, unfocused input — the instant the fetch resolved. If the user had
			already clicked in and started typing before that (a very normal race, given the network
			round-trip), the swap silently dropped focus and the datalist looked like it never loaded.
			Varying only `list`/`placeholder` on one persistent input keeps focus intact throughout.
		-->
		<input
			type="text"
			bind:value={name}
			placeholder={kind === 'generic' ? 'e.g. uses' : 'e.g. owns'}
			list={kind === 'generic' ? 'generic-relation-names' : undefined}
		/>
		{#if kind === 'generic'}
			<datalist id="generic-relation-names">
				{#each genericRelationOptions as option (option.iri)}
					<option value={option.label}></option>
				{/each}
			</datalist>
		{/if}
	</label>
	<label>
		Target entity
		{#if allowRetarget}
			<select bind:value={selectedTarget}>
				{#each targetOptions as option (option.iri)}
					<option value={option.iri}>{option.name}</option>
				{/each}
			</select>
		{:else}
			<span class="static-value">{targetName}</span>
		{/if}
	</label>
	<label class="checkbox">
		<input type="checkbox" bind:checked={required} />
		Required (sh:minCount 1)
	</label>
	<label class="checkbox">
		<input type="checkbox" bind:checked={repeatable} />
		Repeatable (allows multiple values)
	</label>
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
		<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	label.checkbox {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.kind-choice {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.kind-choice legend {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		padding: 0 0.25rem;
	}

	.kind-choice:disabled {
		opacity: 0.6;
	}

	label.radio {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text);
	}

	input[type='text'],
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.static-value {
		font-size: 0.95rem;
		color: var(--color-text);
		padding: 0.5rem 0.65rem;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
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

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
