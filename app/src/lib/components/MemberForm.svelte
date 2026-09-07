<script lang="ts">
	import type { FetchedNamespace, FetchedAssertion, NameableEntity } from '$lib/services/sparql-connector';
	import type { CanvasAttributeSpec, CanvasRelationFieldSpec } from '$lib/services/canvas-model';
	import { isValidIdentifierLocalName, type XsdDatatype } from '$lib/utils/iri';
	import {
		mergeAttributeFormValues,
		reconcileAttributeValues,
		validateRequiredAttributes,
		type AttributeFormValues,
		type AttributeValueSubmission
	} from '$lib/utils/attribute-values';
	import {
		mergeRelationFormValues,
		reconcileRelationValues,
		validateRelationSelections,
		type RelationFormValues,
		type RelationTargetOption,
		type RelationValueSubmission
	} from '$lib/utils/relation-values';

	interface PredicateOption {
		iri: string;
		label: string;
	}

	interface Props {
		mode?: 'create' | 'edit';
		initialLabel?: string;
		namespaceOptions?: FetchedNamespace[];
		initialNamespaceBaseIri?: string;
		submitLabel?: string;
		onSubmit?: (
			label: string,
			namespaceBaseIri?: string,
			attributeSubmissions?: AttributeValueSubmission[],
			identifier?: string,
			relationSubmissions?: RelationValueSubmission[]
		) => Promise<void>;
		onCancel: () => void;
		/** data-catalog Story 019: the edited individual's own IRI — present only in edit mode, since
		 *  a brand-new individual has no IRI yet to be a triple subject. The Assertions section below
		 *  renders only when this is set. */
		individualIri?: string;
		/** Hides the name/namespace form above the Assertions section (relation-assertions Story 010)
		 *  — a reified `rdf:Statement` has no `rdfs:label` identity of its own to rename, unlike a
		 *  standalone individual, so the pencil-on-edge relation-assertion form reuses this component
		 *  for just its Assertions section (`individualIri` set to the statement IRI, `mode="edit"`). */
		hideNameForm?: boolean;
		assertions?: FetchedAssertion[];
		predicateOptions?: PredicateOption[];
		objectOptions?: NameableEntity[];
		onAddAssertion?: (predicateLabel: string, objectIri: string) => Promise<void>;
		onDeleteAssertion?: (predicateIri: string, objectIri: string) => Promise<void>;
		/** The individual's class's own+inherited attribute list (STORY-111, STORY-109's merge
		 *  output) — one input rendered per entry below. Empty (default) renders no Attributes
		 *  section at all, e.g. the reified-statement `hideNameForm` use above. */
		attributes?: CanvasAttributeSpec[];
		/** Current values for `attributes`, keyed by attribute IRI (STORY-110's
		 *  `fetchIndividualAttributeValues` shape) — the edit-mode pre-population. Omitted/empty in
		 *  create mode, where there's nothing to pre-populate yet. */
		attributeValues?: Record<string, string | string[]>;
		/** Whether the class's own `sh:NodeShape` (or an ancestor's) requires `rdfs:label`
		 *  (STORY-112) — purely a visual "required" marker on the Name field; submit already blocks
		 *  on an empty name regardless (today's baseline, unchanged by this flag). */
		labelRequired?: boolean;
		/** The individual's class's own+inherited schema-declared object-property relations
		 *  (STORY-114, STORY-109-style merge output from `mergeAncestorRelations`) — one typeahead
		 *  field rendered per entry, alongside Attributes (not Assertions — see the field's own doc).
		 *  Empty (default) renders no Relations section. */
		relationFields?: CanvasRelationFieldSpec[];
		/** Candidate target individuals for each relation field's typeahead, keyed by relation IRI —
		 *  the caller fetches these scoped to that field's own `targetClassIri` (STORY-114), unlike
		 *  the Assertions section's `objectOptions`, which is every individual in the graph. */
		relationTargetOptions?: Record<string, RelationTargetOption[]>;
	}

	let {
		mode = 'create',
		initialLabel = '',
		namespaceOptions = [],
		initialNamespaceBaseIri = '',
		submitLabel,
		onSubmit,
		onCancel,
		individualIri,
		hideNameForm = false,
		assertions = [],
		predicateOptions = [],
		objectOptions = [],
		onAddAssertion,
		onDeleteAssertion,
		attributes = [],
		attributeValues = {},
		labelRequired = false,
		relationFields = [],
		relationTargetOptions = {}
	}: Props = $props();

	let label = $state(initialLabel);
	let namespaceBaseIri = $state(initialNamespaceBaseIri);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	// -- User-specified identifier (STORY-113) -----------------------------------------------------
	// Create-mode only (see Props doc) — an existing individual's IRI never changes after creation.
	let identifier = $state('');
	let identifierError = $state<string | null>(null);

	// -- Attributes (STORY-111) -------------------------------------------------------------------
	// `originalAttributeValues` is captured once at mount (this component remounts, rather than
	// re-rendering in place, whenever the caller switches which individual is being edited — see
	// `ManageMembersModal`'s `{#if showAddForm}{:else if editTarget}` branching), so it stays a
	// stable diff baseline for `reconcileAttributeValues` on submit.
	const originalAttributeValues: AttributeFormValues = mergeAttributeFormValues(attributes, attributeValues);
	let formValues = $state<AttributeFormValues>(structuredClone(originalAttributeValues));
	let missingRequiredAttributes = $state<Set<string>>(new Set());

	// -- Relation fields (STORY-114) ---------------------------------------------------------------
	// Schema-declared owl:ObjectProperty relations, rendered as typeahead fields alongside Attributes
	// (not Assertions — see the `relationFields` prop doc). Pre-populated from `assertions` (already
	// loaded for the Assertions section below) filtered to each field's own predicate IRI, rather than
	// a separate fetch. `relationFieldIris` also drives hiding these predicates from the generic
	// Assertions add-form and list, per the confirmed "one canonical way to set it" decision.
	const relationFieldIris = new Set(relationFields.map((r) => r.iri));
	const originalRelationObjectIris: Record<string, string[]> = {};
	const relationAssertedLabels: Record<string, string[]> = {};
	for (const rel of relationFields) {
		const matches = assertions.filter((a) => a.predicateIri === rel.iri);
		originalRelationObjectIris[rel.iri] = matches.map((a) => a.objectIri);
		relationAssertedLabels[rel.iri] = matches.map((a) => objectDisplayLabel(a));
	}
	const originalRelationFormValues: RelationFormValues = mergeRelationFormValues(relationFields, relationAssertedLabels);
	let relationFormValues = $state<RelationFormValues>(structuredClone(originalRelationFormValues));
	let missingRelationFields = $state<Set<string>>(new Set());
	let invalidRelationFields = $state<Set<string>>(new Set());

	function setRelationValue(relIri: string, rowIndex: number | null, value: string) {
		if (rowIndex === null) {
			relationFormValues = { ...relationFormValues, [relIri]: value };
		} else {
			const rows = [...((relationFormValues[relIri] as string[] | undefined) ?? [])];
			rows[rowIndex] = value;
			relationFormValues = { ...relationFormValues, [relIri]: rows };
		}
	}

	function addRelationRow(relIri: string) {
		const rows = [...((relationFormValues[relIri] as string[] | undefined) ?? []), ''];
		relationFormValues = { ...relationFormValues, [relIri]: rows };
	}

	function removeRelationRow(relIri: string, rowIndex: number) {
		const rows = ((relationFormValues[relIri] as string[] | undefined) ?? []).filter((_, i) => i !== rowIndex);
		relationFormValues = { ...relationFormValues, [relIri]: rows };
	}

	const inputTypeByDatatype: Record<XsdDatatype, string> = {
		string: 'text',
		integer: 'number',
		decimal: 'number',
		date: 'date',
		dateTime: 'datetime-local',
		boolean: 'checkbox',
		anyURI: 'url'
	};

	function setAttributeValue(attrIri: string, rowIndex: number | null, value: string) {
		if (rowIndex === null) {
			formValues = { ...formValues, [attrIri]: value };
		} else {
			const rows = [...((formValues[attrIri] as string[] | undefined) ?? [])];
			rows[rowIndex] = value;
			formValues = { ...formValues, [attrIri]: rows };
		}
	}

	function addAttributeRow(attrIri: string) {
		const rows = [...((formValues[attrIri] as string[] | undefined) ?? []), ''];
		formValues = { ...formValues, [attrIri]: rows };
	}

	function removeAttributeRow(attrIri: string, rowIndex: number) {
		const rows = ((formValues[attrIri] as string[] | undefined) ?? []).filter((_, i) => i !== rowIndex);
		formValues = { ...formValues, [attrIri]: rows };
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!label.trim()) {
			error = 'Label must not be empty';
			return;
		}
		const trimmedIdentifier = mode === 'create' ? identifier.trim() : '';
		if (trimmedIdentifier && !isValidIdentifierLocalName(trimmedIdentifier)) {
			identifierError = 'Identifier must start with a letter or digit and contain only letters, digits, "_" or "-"';
			return;
		}
		identifierError = null;
		const missing = validateRequiredAttributes(attributes, formValues);
		if (missing.length > 0) {
			missingRequiredAttributes = new Set(missing);
			error = 'Please fill in all required fields.';
			return;
		}
		missingRequiredAttributes = new Set();
		const { missing: missingRelations, invalid: invalidRelations } = validateRelationSelections(
			relationFields,
			relationFormValues,
			relationTargetOptions
		);
		if (missingRelations.length > 0 || invalidRelations.length > 0) {
			missingRelationFields = new Set(missingRelations);
			invalidRelationFields = new Set(invalidRelations);
			error = 'Please fill in all required fields.';
			return;
		}
		missingRelationFields = new Set();
		invalidRelationFields = new Set();
		if (!onSubmit) return;
		error = null;
		submitting = true;
		try {
			const attributeSubmissions = reconcileAttributeValues(attributes, originalAttributeValues, formValues);
			const relationSubmissions = reconcileRelationValues(
				relationFields,
				originalRelationObjectIris,
				relationFormValues,
				relationTargetOptions
			);
			await onSubmit(
				label.trim(),
				mode === 'create' ? namespaceBaseIri : undefined,
				attributeSubmissions,
				trimmedIdentifier || undefined,
				relationSubmissions
			);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}

	const kindLabels: Record<NameableEntity['kind'], string> = {
		class: 'Class',
		attribute: 'Attribute',
		relation: 'Relation',
		individual: 'Individual',
		relationInstance: 'Relation instance'
	};

	let showAddAssertion = $state(false);
	let newPredicateLabel = $state('');
	let newObjectLabel = $state('');
	let assertionError = $state<string | null>(null);
	let assertionSubmitting = $state(false);

	function cancelAddAssertion() {
		showAddAssertion = false;
		newPredicateLabel = '';
		newObjectLabel = '';
		assertionError = null;
	}

	async function submitAddAssertion() {
		if (!onAddAssertion) return;
		const predicateLabel = newPredicateLabel.trim();
		const objectLabelValue = newObjectLabel.trim();
		if (!predicateLabel || !objectLabelValue) {
			assertionError = 'Predicate and object must not be empty';
			return;
		}
		const match = objectOptions.find((o) => o.label === objectLabelValue);
		if (!match) {
			assertionError = 'Object must be selected from the list';
			return;
		}
		assertionError = null;
		assertionSubmitting = true;
		try {
			await onAddAssertion(predicateLabel, match.iri);
			cancelAddAssertion();
		} catch (err) {
			assertionError = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			assertionSubmitting = false;
		}
	}

	async function handleDeleteAssertion(a: FetchedAssertion) {
		if (!onDeleteAssertion) return;
		await onDeleteAssertion(a.predicateIri, a.objectIri);
	}

	/** Prefers `objectOptions`' own label over the assertion's own `objectLabel` fetch — an
	 *  attribute's label there is already disambiguated with its owning entity's name
	 *  (`"Application.Name"`, see `fetchNameableEntities`), which the assertion's own plain
	 *  `rdfs:label` lookup can't provide since it doesn't know the object's owning class. Falls back
	 *  to `objectLabel` when the object isn't in `objectOptions` (e.g. options not loaded yet). */
	function objectDisplayLabel(a: FetchedAssertion): string {
		return objectOptions.find((o) => o.iri === a.objectIri)?.label ?? a.objectLabel;
	}
</script>

{#snippet attributeInput(attr: CanvasAttributeSpec, rowIndex: number | null)}
	{@const rawValue = rowIndex === null ? (formValues[attr.iri] as string | undefined) : ((formValues[attr.iri] as string[] | undefined)?.[rowIndex])}
	{#if attr.datatype === 'boolean'}
		<input
			type="checkbox"
			checked={rawValue === 'true'}
			onchange={(e) => setAttributeValue(attr.iri, rowIndex, (e.currentTarget as HTMLInputElement).checked ? 'true' : 'false')}
		/>
	{:else}
		<input
			type={inputTypeByDatatype[attr.datatype]}
			value={rawValue ?? ''}
			oninput={(e) => setAttributeValue(attr.iri, rowIndex, (e.currentTarget as HTMLInputElement).value)}
		/>
	{/if}
{/snippet}

{#snippet relationInput(rel: CanvasRelationFieldSpec, rowIndex: number | null)}
	{@const rawValue = rowIndex === null ? (relationFormValues[rel.iri] as string | undefined) : ((relationFormValues[rel.iri] as string[] | undefined)?.[rowIndex])}
	{@const listId = `relation-target-options-${rel.iri.replace(/[^A-Za-z0-9]/g, '-')}`}
	<input
		type="text"
		value={rawValue ?? ''}
		list={listId}
		placeholder={`Select a ${rel.targetClassName}…`}
		oninput={(e) => setRelationValue(rel.iri, rowIndex, (e.currentTarget as HTMLInputElement).value)}
	/>
	<datalist id={listId}>
		{#each relationTargetOptions[rel.iri] ?? [] as option (option.iri)}
			<option value={option.label}></option>
		{/each}
	</datalist>
{/snippet}

{#if !hideNameForm}
	<form onsubmit={handleSubmit}>
		<label>
			Label{#if labelRequired}<span class="required-mark"> *</span>{/if}
			<input type="text" bind:value={label} placeholder="e.g. nutzt" />
		</label>
		{#if mode === 'create' && namespaceOptions.length > 0}
			<label>
				Namespace
				<select bind:value={namespaceBaseIri}>
					{#each namespaceOptions as ns (ns.baseIri)}
						<option value={ns.baseIri}>{ns.prefix}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if mode === 'create'}
			<label>
				Identifier <span class="optional-hint">(optional)</span>
				<input
					type="text"
					bind:value={identifier}
					placeholder="e.g. acmeCorp — leave blank to auto-generate"
				/>
			</label>
			{#if identifierError}
				<p class="error">{identifierError}</p>
			{/if}
		{/if}
		{#if attributes.length > 0}
			<div class="attributes-section">
				<h4>Attributes</h4>
				{#each attributes as attr (attr.iri)}
					<div class="attribute-field">
						<span class="attribute-label">
							{attr.name}{#if attr.required}<span class="required-mark"> *</span>{/if}
							{#if attr.inheritedFrom}
								<span class="attr-inherited-from">from {attr.inheritedFrom.className}</span>
							{/if}
						</span>
						{#if attr.repeatable}
							{#each (formValues[attr.iri] as string[] | undefined) ?? [] as _, i}
								<div class="repeatable-row">
									{@render attributeInput(attr, i)}
									<button
										type="button"
										class="icon-button"
										onclick={() => removeAttributeRow(attr.iri, i)}
										aria-label={`Remove ${attr.name} value`}
										title="Remove"
									>
										×
									</button>
								</div>
							{/each}
							<button type="button" class="add-member" onclick={() => addAttributeRow(attr.iri)}>
								+ Add another
							</button>
						{:else}
							{@render attributeInput(attr, null)}
						{/if}
						{#if missingRequiredAttributes.has(attr.iri)}
							<p class="error attribute-error">{attr.name} is required.</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if relationFields.length > 0}
			<div class="attributes-section">
				<h4>Relations</h4>
				{#each relationFields as rel (rel.iri)}
					<div class="attribute-field">
						<span class="attribute-label">
							{rel.name}{#if rel.required}<span class="required-mark"> *</span>{/if}
							{#if rel.inheritedFrom}
								<span class="attr-inherited-from">from {rel.inheritedFrom.className}</span>
							{/if}
						</span>
						{#if rel.repeatable}
							{#each (relationFormValues[rel.iri] as string[] | undefined) ?? [] as _, i}
								<div class="repeatable-row">
									{@render relationInput(rel, i)}
									<button
										type="button"
										class="icon-button"
										onclick={() => removeRelationRow(rel.iri, i)}
										aria-label={`Remove ${rel.name} value`}
										title="Remove"
									>
										×
									</button>
								</div>
							{/each}
							<button type="button" class="add-member" onclick={() => addRelationRow(rel.iri)}>
								+ Add another
							</button>
						{:else}
							{@render relationInput(rel, null)}
						{/if}
						{#if missingRelationFields.has(rel.iri)}
							<p class="error attribute-error">{rel.name} is required.</p>
						{/if}
						{#if invalidRelationFields.has(rel.iri)}
							<p class="error attribute-error">{rel.name} must be selected from the list.</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
			<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
		</div>
	</form>
{/if}

{#if mode === 'edit' && individualIri}
	<div class="assertions">
		<h4>Assertions</h4>
		<ul class="assertion-list">
			{#each assertions.filter((a) => !relationFieldIris.has(a.predicateIri)) as a (a.predicateIri + a.objectIri)}
				<li>
					<span class="predicate">{a.predicateLabel}</span>
					<span class="object">{objectDisplayLabel(a)}</span>
					<button
						type="button"
						class="icon-button"
						onclick={() => handleDeleteAssertion(a)}
						aria-label={`Delete ${a.predicateLabel} ${objectDisplayLabel(a)}`}
						title="Delete"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				</li>
			{:else}
				<li class="empty">No assertions yet.</li>
			{/each}
		</ul>

		{#if showAddAssertion}
			<div class="add-assertion">
				<label>
					Predicate
					<input
						type="text"
						bind:value={newPredicateLabel}
						list="assertion-predicate-names"
						placeholder="e.g. isMasterFor"
					/>
					<datalist id="assertion-predicate-names">
						{#each predicateOptions.filter((p) => !relationFieldIris.has(p.iri)) as p (p.iri)}
							<option value={p.label}></option>
						{/each}
					</datalist>
				</label>
				<label>
					Object
					<input
						type="text"
						bind:value={newObjectLabel}
						list="assertion-object-names"
						placeholder="e.g. SchutzobjektID"
					/>
					<datalist id="assertion-object-names">
						{#each objectOptions as o (o.iri)}
							<option value={o.label}>{kindLabels[o.kind]}</option>
						{/each}
					</datalist>
				</label>
				{#if assertionError}
					<p class="error">{assertionError}</p>
				{/if}
				<div class="actions">
					<button type="button" class="secondary" onclick={cancelAddAssertion} disabled={assertionSubmitting}>
						Cancel
					</button>
					<button type="button" class="primary" onclick={submitAddAssertion} disabled={assertionSubmitting}>
						{assertionSubmitting ? 'Adding…' : 'Add'}
					</button>
				</div>
			</div>
		{:else}
			<button type="button" class="add-member" onclick={() => (showAddAssertion = true)}>+ Add assertion</button>
		{/if}
	</div>
{/if}

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
	select {
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

	.required-mark {
		color: var(--color-error);
	}

	.optional-hint {
		font-weight: normal;
		color: var(--color-text-muted);
	}

	.attributes-section {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border-top: 1px solid var(--color-border);
		padding-top: 0.75rem;
	}

	.attributes-section h4 {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.attribute-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.attribute-label {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.attribute-field .attr-inherited-from {
		margin-left: 0.5rem;
		font-size: 0.75rem;
		font-style: italic;
		color: var(--color-text-muted);
	}

	.attribute-field input[type='checkbox'] {
		width: 1rem;
		height: 1rem;
		align-self: flex-start;
	}

	.repeatable-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.repeatable-row input {
		flex: 1;
	}

	.repeatable-row .icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		min-height: 22px;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		flex-shrink: 0;
		font-size: 1rem;
		line-height: 1;
		padding: 0;
	}

	.repeatable-row .icon-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.attribute-error {
		margin: 0;
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

	.assertions {
		margin-top: 1.25rem;
		border-top: 1px solid var(--color-border);
		padding-top: 1rem;
	}

	.assertions h4 {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.assertion-list {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.assertion-list li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.assertion-list li:first-child {
		border-top: none;
	}

	.assertion-list li.empty {
		color: var(--color-text-muted);
	}

	.assertion-list .predicate {
		font-weight: 600;
		flex-shrink: 0;
	}

	.assertion-list .object {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assertion-list .icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		min-height: 22px;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
		flex-shrink: 0;
	}

	.assertion-list .icon-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.add-assertion {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.75rem;
	}

	.add-member {
		width: 100%;
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.85rem;
		color: var(--color-accent);
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		background: transparent;
	}

	.add-member:hover {
		background: var(--color-hover);
	}
</style>
