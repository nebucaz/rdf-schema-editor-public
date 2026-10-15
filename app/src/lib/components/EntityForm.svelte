<script lang="ts">
	import ColorSwatchPicker from './ColorSwatchPicker.svelte';
	import type { FetchedNamespace, NameableEntity } from '$lib/services/sparql-connector';
	import type { CanvasClassLevelAttributeSpec } from '$lib/services/canvas-model';
	import type { XsdDatatype } from '$lib/utils/iri';

	interface Props {
		mode?: 'create' | 'edit';
		iri?: string;
		initialName?: string;
		initialDescription?: string;
		initialColor?: string;
		/** Current `backstageKind` annotation (Story 005), if any — empty string means unset. */
		initialBackstageKind?: string;
		/** STORY-100: this class's own `rse:namespace` value (base IRI), if it declares one directly
		 *  — empty string means unset (inherits, per `effectiveConceptNamespace`'s indicator below).
		 *  Rendered as a `<select>` constrained to `namespaceOptions` (a *registered* namespace, same
		 *  set the "Namespace" field below picks from) — a value here that isn't itself in
		 *  `namespaceOptions` (a stale value set before this constraint existed) won't appear selected
		 *  until the field is explicitly re-picked, since an unregistered Concept Namespace is exactly
		 *  what orphaned data before (nothing ever queries an unregistered namespace's graph again). */
		initialConceptNamespace?: string;
		/** STORY-100: the currently-effective Backstage-sync Concept Namespace (own declaration or
		 *  inherited from an ancestor via `rdfs:subClassOf*`), for the "own vs inherited" indicator —
		 *  `null` when neither this class nor any ancestor declares one; omitted (`undefined`)
		 *  suppresses the indicator entirely (e.g. create mode, where there's no existing class to
		 *  walk ancestry from yet). */
		effectiveConceptNamespace?: { baseIri: string; own: boolean } | null;
		/** Whether this class is a direct `rdfs:subClassOf` the user-configured Catalog marker class
		 *  (Settings' "Catalog marker class" — the same marker `isAuthoritativeEntity` already checks
		 *  for DCAT catalog eligibility; never a hardcoded class name). When true, Concept Namespace
		 *  becomes a required field (must resolve to *some* effective value, own or inherited) rather
		 *  than the purely optional field it is for every other class. Edit mode only, like
		 *  `effectiveConceptNamespace`, since create mode has no `rdfs:subClassOf` relationship yet to
		 *  check. */
		requireConceptNamespace?: boolean;
		/** Attributes a direct superclass marks "required for subclasses" (general mechanism, not
		 *  Backstage-specific — `REQUIRED_FOR_SUBCLASSES_PREDICATE_IRI`) — one input rendered per
		 *  entry, required regardless of the "Required" checkbox on the attribute itself. Edit mode
		 *  only, like `requireConceptNamespace` above (no `rdfs:subClassOf` relationship exists yet
		 *  at create time). */
		subclassRequiredAttributes?: CanvasClassLevelAttributeSpec[];
		/** This class's own current value per `subclassRequiredAttributes` entry, keyed by attribute
		 *  IRI — the edit-mode pre-population, fetched alongside `initialConceptNamespace`. */
		subclassAttributeValues?: Record<string, string>;
		/** Registered namespaces — backs both the "Namespace" select (create mode, this class's own
		 *  declaring namespace) and the "Concept namespace" select above (any mode, STORY-100's
		 *  Backstage-sync target namespace). Empty hides the "Namespace" field entirely (create mode
		 *  still needs *some* namespace to mint the class into, so it falls back silently); the
		 *  "Concept namespace" field stays visible either way since it's always optional. */
		namespaceOptions?: FetchedNamespace[];
		initialNamespaceBaseIri?: string;
		/** Create mode only: existing classes/individuals to match the typed name against, so a name
		 *  that already exists in the graph can be placed on the canvas instead of creating a
		 *  duplicate. Omit (or leave empty) to disable the lookup. */
		existingOptions?: NameableEntity[];
		submitLabel: string;
		onSubmit: (
			name: string,
			description: string,
			color: string | undefined,
			namespaceBaseIri: string | undefined,
			backstageKind: string,
			conceptNamespace: string,
			subclassAttributeValues: Record<string, string>
		) => Promise<void>;
		/** Create mode only, paired with `existingOptions`: called instead of `onSubmit` when the typed
		 *  name exactly matches an existing class/individual — adds that existing element to the
		 *  workspace rather than minting a new one. */
		onSelectExisting?: (entity: NameableEntity) => Promise<void>;
		onCancel: () => void;
	}

	let {
		mode = 'create',
		iri,
		initialName = '',
		initialDescription = '',
		initialColor,
		initialBackstageKind = '',
		initialConceptNamespace = '',
		effectiveConceptNamespace = undefined,
		requireConceptNamespace = false,
		subclassRequiredAttributes = [],
		subclassAttributeValues = {},
		namespaceOptions = [],
		initialNamespaceBaseIri = '',
		existingOptions = [],
		submitLabel,
		onSubmit,
		onSelectExisting,
		onCancel
	}: Props = $props();

	const existingKindLabels: Record<string, string> = { class: 'Class', individual: 'Individual' };

	let name = $state(initialName);
	let description = $state(initialDescription);
	let color = $state<string | undefined>(initialColor);
	let backstageKind = $state(initialBackstageKind);
	let conceptNamespace = $state(initialConceptNamespace);
	let namespaceBaseIri = $state(initialNamespaceBaseIri);
	let subclassAttrValues = $state<Record<string, string>>({ ...subclassAttributeValues });
	let error = $state<string | null>(null);
	let submitting = $state(false);

	const inputTypeByDatatype: Record<XsdDatatype, string> = {
		string: 'text',
		integer: 'number',
		decimal: 'number',
		date: 'date',
		dateTime: 'datetime-local',
		boolean: 'text',
		anyURI: 'url'
	};

	/** Registered-namespace prefix an element's IRI belongs to (`<base>#x` instances, `<base>/schema#x`
	 *  classes), so same-named elements in different namespaces stay distinguishable in the lookup. */
	function namespaceLabel(elementIri: string): string {
		const ns = namespaceOptions
			.filter((n) => elementIri.startsWith(`${n.baseIri}#`) || elementIri.startsWith(`${n.baseIri}/`))
			.sort((a, b) => b.baseIri.length - a.baseIri.length)[0];
		return ns?.prefix ?? '';
	}

	let nameMatches = $derived(
		mode === 'create'
			? existingOptions.filter((o) => o.label.trim().toLowerCase() === name.trim().toLowerCase())
			: []
	);
	/** The match sitting in the namespace currently picked below — a new element with this name
	 *  there would be a duplicate, so only "Add Existing" is offered. */
	let matchInSelectedNamespace = $derived(
		namespaceBaseIri
			? nameMatches.find((o) => o.iri.startsWith(`${namespaceBaseIri}#`))
			: undefined
	);
	/** Same name exists, but only in other namespaces: offer both "Add Existing" and "Add New". */
	let matchedExisting = $derived(matchInSelectedNamespace ?? nameMatches[0]);
	let canAddNew = $derived(!!matchedExisting && !matchInSelectedNamespace);
	/** Fields feed "Add New", so they stay editable whenever it is offered. */
	let fieldsLocked = $derived(!!matchedExisting && !canAddNew);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		await submit(false);
	}

	async function submit(forceNew: boolean) {
		if (!name.trim()) {
			error = 'Name must not be empty';
			return;
		}
		if (
			requireConceptNamespace &&
			!conceptNamespace.trim() &&
			(effectiveConceptNamespace === null || effectiveConceptNamespace === undefined)
		) {
			error = 'Concept namespace is required for a direct subclass of the configured Catalog marker class';
			return;
		}
		for (const attr of subclassRequiredAttributes) {
			if (!(subclassAttrValues[attr.iri] ?? '').trim()) {
				error = `"${attr.name}" is required for a direct subclass of ${attr.ownerClassName}`;
				return;
			}
		}
		error = null;
		submitting = true;
		try {
			if (matchedExisting && onSelectExisting && !forceNew) {
				await onSelectExisting(matchedExisting);
			} else {
				await onSubmit(
					name.trim(),
					description.trim(),
					color,
					mode === 'create' ? namespaceBaseIri : undefined,
					backstageKind.trim(),
					conceptNamespace.trim(),
					Object.fromEntries(
						subclassRequiredAttributes.map((attr) => [attr.iri, (subclassAttrValues[attr.iri] ?? '').trim()])
					)
				);
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	{#if mode === 'edit' && iri}
		<label>
			IRI
			<input type="text" class="iri" value={iri} readonly title={iri} />
		</label>
	{/if}
	<label>
		Name
		<input
			type="text"
			bind:value={name}
			placeholder="e.g. Person"
			list={mode === 'create' && existingOptions.length > 0 ? 'entity-existing-names' : undefined}
			autocomplete="off"
		/>
	</label>
	{#if mode === 'create' && existingOptions.length > 0}
		<datalist id="entity-existing-names">
			{#each existingOptions as o (o.iri)}
				<option value={o.label}>
					{existingKindLabels[o.kind] ?? o.kind}{#if namespaceLabel(o.iri)} · {namespaceLabel(o.iri)}{/if}
				</option>
			{/each}
		</datalist>
	{/if}
	{#if matchedExisting}
		<p class="hint">
			A {existingKindLabels[matchedExisting.kind]?.toLowerCase() ?? matchedExisting.kind} named "{matchedExisting.label}"{#if namespaceLabel(matchedExisting.iri)} ({namespaceLabel(matchedExisting.iri)}){/if}
			{#if canAddNew}
				already exists in another namespace — add that one, or create a new one in the selected namespace.
			{:else}
				already exists in this namespace — submitting will add it to the workspace instead of creating a duplicate.
			{/if}
		</p>
	{/if}
	<label>
		Description
		<textarea
			bind:value={description}
			placeholder="Optional description"
			rows="3"
			disabled={fieldsLocked}
		></textarea>
	</label>
	<label>
		Color
		<ColorSwatchPicker {color} onChange={(c) => (color = c)} disabled={fieldsLocked} />
	</label>
	<label>
		Backstage kind
		<input
			type="text"
			bind:value={backstageKind}
			placeholder="Optional — e.g. Component"
			disabled={fieldsLocked}
		/>
	</label>
	<label>
		Concept namespace{#if requireConceptNamespace}<span class="required-mark"> *</span>{/if}
		<select bind:value={conceptNamespace} disabled={fieldsLocked}>
			<option value="">
				{effectiveConceptNamespace?.own === false
					? `— None — inherits ${effectiveConceptNamespace.baseIri} —`
					: '— None —'}
			</option>
			{#each namespaceOptions as ns (ns.baseIri)}
				<option value={ns.baseIri}>{ns.prefix}</option>
			{/each}
		</select>
	</label>
	{#if effectiveConceptNamespace !== undefined}
		<p class="hint">
			{#if effectiveConceptNamespace === null}
				No Concept Namespace configured (own or inherited) — Backstage sync will skip this class.
			{:else if effectiveConceptNamespace.own}
				Set directly on this class.
			{:else}
				Inherited from an ancestor class: <code>{effectiveConceptNamespace.baseIri}</code>
			{/if}
		</p>
	{/if}
	{#each subclassRequiredAttributes as attr (attr.iri)}
		<label>
			{attr.name}<span class="required-mark"> *</span>
			<input
				type={inputTypeByDatatype[attr.datatype]}
				value={subclassAttrValues[attr.iri] ?? ''}
				oninput={(e) => (subclassAttrValues = { ...subclassAttrValues, [attr.iri]: (e.currentTarget as HTMLInputElement).value })}
				disabled={fieldsLocked}
			/>
		</label>
		<p class="hint">Required for a direct subclass of <code>{attr.ownerClassName}</code>.</p>
	{/each}
	{#if mode === 'create' && namespaceOptions.length > 0}
		<label>
			Namespace
			<select bind:value={namespaceBaseIri} disabled={fieldsLocked}>
				{#each namespaceOptions as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix}</option>
				{/each}
			</select>
		</label>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
		{#if canAddNew}
			<button type="button" class="secondary" disabled={submitting} onclick={() => submit(true)}>
				Add New
			</button>
			<button type="submit" class="primary" disabled={submitting}>
				{submitting ? 'Saving…' : 'Add Existing'}
			</button>
		{:else}
			<button type="submit" class="primary" disabled={submitting}>
				{submitting ? 'Saving…' : matchedExisting ? 'Add Existing' : submitLabel}
			</button>
		{/if}
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

	input,
	textarea,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	input.iri {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		background: var(--color-bg-secondary);
	}

	input:disabled,
	textarea:disabled,
	select:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.8rem;
		margin: -0.5rem 0 0;
	}

	.hint code {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		font-size: 0.75rem;
	}

	.required-mark {
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
