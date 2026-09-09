<script lang="ts">
	interface TargetOption {
		iri: string;
		name: string;
	}

	interface GenericRelationOption {
		iri: string;
		label: string;
		/** `[prefix] label` — the option's owning-namespace-prefixed display text, shown as the
		 *  datalist suggestion's hint so relations from other namespaces (e.g. `core:represents`,
		 *  offered while drawing from a `backstage:`-namespaced entity) are distinguishable from one
		 *  another before picking. Selecting a suggestion still fills the input with the plain
		 *  `label` (not this prefixed form) — reuse is resolved by label alone, across every
		 *  namespace, so the plain label is what actually needs to reach `onSubmit`. */
		displayLabel: string;
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
		/** Existing generic relations across every namespace, for the "reuse an existing one"
		 *  autocomplete (STORY-051's `listGenericObjectProperties`, widened cross-namespace). Ignored
		 *  when `allowGeneric` is false. */
		genericRelationOptions?: GenericRelationOption[];
		/** The relation's current kind when editing — fixed (not user-editable) once created, since
		 *  switching kinds isn't supported. Defaults to 'specific' when creating. */
		initialKind?: RelationKind;
		/** Hides the Required/Repeatable checkboxes (relation-assertions unified edit modal) — those
		 *  are SHACL `sh:property` cardinality constraints on a schema relation between two classes;
		 *  an individual-involving relation is a plain ground triple with no such shape, so the fields
		 *  don't apply. `required`/`repeatable` are still passed through to `onSubmit` unchanged
		 *  (`false`/`false`) when hidden — callers that don't use them for that relation kind simply
		 *  ignore the values. */
		showConstraints?: boolean;
		/** Shows the relation-mapping-information field (STORY-107) — opt-in and independent of
		 *  `showConstraints`, since only the plain class→class "Relation" flow (not the
		 *  attributed-link/association-class flow, which also has `showConstraints` true) currently
		 *  wires its save handler to actually persist `rse:sourceRelation`. Defaults to false so a
		 *  caller that doesn't pass it never renders a field its own onSubmit silently drops. */
		allowSourceRelation?: boolean;
		/** The relation's current `rse:sourceRelation` mapping information (STORY-107), empty when
		 *  unset. Ignored when `allowSourceRelation` is false. */
		initialSourceRelation?: string;
		/** Shows the "Define reverse relation" section (STORY-XXX) — opt-in like
		 *  `allowSourceRelation`, and further gated on `kind === 'specific'` internally (a generic
		 *  relation has no fixed domain/range pair to swap). Only meaningful for the plain class→class
		 *  "Relation" flow. */
		allowReverseRelation?: boolean;
		/** Whether this relation currently has a reverse defined (STORY-XXX) — pre-checks the
		 *  checkbox when editing a relation whose reverse already exists. Ignored when
		 *  `allowReverseRelation` is false. */
		initialDefineReverse?: boolean;
		/** The existing reverse relation's name, empty when none is defined yet. Ignored when
		 *  `allowReverseRelation` is false. */
		initialReverseName?: string;
		/** The existing reverse relation's own `rse:sourceRelation` mapping, empty when unset.
		 *  Ignored when `allowReverseRelation` is false. */
		initialReverseSourceRelation?: string;
		onSubmit: (
			name: string,
			targetIri: string,
			required: boolean,
			repeatable: boolean,
			kind: RelationKind,
			sourceRelation: string,
			defineReverse: boolean,
			reverseName: string,
			reverseSourceRelation: string
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
		showConstraints = true,
		allowSourceRelation = false,
		initialSourceRelation = '',
		allowReverseRelation = false,
		initialDefineReverse = false,
		initialReverseName = '',
		initialReverseSourceRelation = '',
		onSubmit,
		onCancel
	}: Props = $props();

	let name = $state(initialName);
	let selectedTarget = $state(targetIri);
	let required = $state(initialRequired);
	let repeatable = $state(initialRepeatable);
	let sourceRelation = $state(initialSourceRelation);
	let defineReverse = $state(initialDefineReverse);
	let reverseName = $state(initialReverseName);
	let reverseSourceRelation = $state(initialReverseSourceRelation);
	let kind = $state<RelationKind>(initialKind);
	let error = $state<string | null>(null);
	let success = $state(false);
	let submitting = $state(false);

	// Any further edit after a successful save invalidates that "Saved" confirmation — it describes
	// the fields as they were at save time, not their current (unsaved) values. Mirrors
	// SettingsView.svelte's clearSaveSuccess.
	function clearSuccess() {
		success = false;
	}

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
		if (allowReverseRelation && kind === 'specific' && defineReverse && !reverseName.trim()) {
			error = 'Reverse name must not be empty';
			return;
		}
		error = null;
		success = false;
		submitting = true;
		try {
			await onSubmit(
				name.trim(),
				selectedTarget,
				required,
				repeatable,
				kind,
				sourceRelation.trim(),
				allowReverseRelation && kind === 'specific' && defineReverse,
				reverseName.trim(),
				reverseSourceRelation.trim()
			);
			success = true;
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
				<input type="radio" name="kind" value="specific" bind:group={kind} onchange={clearSuccess} />
				Specific — new relation for this pair of entities
			</label>
			<label class="radio">
				<input type="radio" name="kind" value="generic" bind:group={kind} onchange={clearSuccess} />
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
			oninput={clearSuccess}
			placeholder={kind === 'generic' ? 'e.g. uses' : 'e.g. owns'}
			list={kind === 'generic' ? 'generic-relation-names' : undefined}
		/>
		{#if kind === 'generic'}
			<datalist id="generic-relation-names">
				{#each genericRelationOptions as option (option.iri)}
					<option value={option.label} label={option.displayLabel}></option>
				{/each}
			</datalist>
		{/if}
	</label>
	<label>
		Target
		{#if allowRetarget}
			<select bind:value={selectedTarget} onchange={clearSuccess}>
				{#each targetOptions as option (option.iri)}
					<option value={option.iri}>{option.name}</option>
				{/each}
			</select>
		{:else}
			<span class="static-value">{targetName}</span>
		{/if}
	</label>
	{#if showConstraints}
		<label class="checkbox">
			<input type="checkbox" bind:checked={required} onchange={clearSuccess} />
			Required (sh:minCount 1)
		</label>
		<label class="checkbox">
			<input type="checkbox" bind:checked={repeatable} onchange={clearSuccess} />
			Repeatable (allows multiple values)
		</label>
	{/if}
	{#if allowSourceRelation}
		<label>
			Mapping information
			<input type="text" bind:value={sourceRelation} oninput={clearSuccess} placeholder="e.g. ownedBy" />
			<span class="hint">
				Tells the ingestion source configured for this class which of its own relation types this
				property represents. The exact value — a relation-type string, a role name, or something
				else — is up to that source to interpret. Leave empty to leave this relation unmapped.
			</span>
		</label>
	{/if}
	{#if allowReverseRelation && kind === 'specific'}
		<label class="checkbox">
			<input type="checkbox" bind:checked={defineReverse} onchange={clearSuccess} />
			Define reverse relation
		</label>
		{#if defineReverse}
			<label>
				Reverse name
				<input type="text" bind:value={reverseName} oninput={clearSuccess} placeholder="e.g. ownedBy" />
			</label>
			<label>
				Reverse mapping information
				<input
					type="text"
					bind:value={reverseSourceRelation}
					oninput={clearSuccess}
					placeholder="e.g. ownedBy"
				/>
				<span class="hint">
					Same idea as this relation's own mapping information above, but for the reverse property —
					the ingestion source may report the reverse direction as a separate relation type.
				</span>
			</label>
		{/if}
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if success}
		<p class="success" role="status">Saved.</p>
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

	.success {
		color: var(--color-success);
		background: var(--color-success-bg);
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
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
