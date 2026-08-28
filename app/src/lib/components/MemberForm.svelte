<script lang="ts">
	import type { FetchedNamespace, FetchedAssertion, NameableEntity } from '$lib/services/sparql-connector';

	interface PredicateOption {
		iri: string;
		label: string;
	}

	interface Props {
		mode?: 'create' | 'edit';
		initialLabel?: string;
		namespaceOptions?: FetchedNamespace[];
		initialNamespaceBaseIri?: string;
		submitLabel: string;
		onSubmit: (label: string, namespaceBaseIri?: string) => Promise<void>;
		onCancel: () => void;
		/** data-catalog Story 019: the edited individual's own IRI — present only in edit mode, since
		 *  a brand-new individual has no IRI yet to be a triple subject. The Assertions section below
		 *  renders only when this is set. */
		individualIri?: string;
		assertions?: FetchedAssertion[];
		predicateOptions?: PredicateOption[];
		objectOptions?: NameableEntity[];
		onAddAssertion?: (predicateLabel: string, objectIri: string) => Promise<void>;
		onDeleteAssertion?: (predicateIri: string, objectIri: string) => Promise<void>;
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
		assertions = [],
		predicateOptions = [],
		objectOptions = [],
		onAddAssertion,
		onDeleteAssertion
	}: Props = $props();

	let label = $state(initialLabel);
	let namespaceBaseIri = $state(initialNamespaceBaseIri);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!label.trim()) {
			error = 'Name must not be empty';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit(label.trim(), mode === 'create' ? namespaceBaseIri : undefined);
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
		individual: 'Individual'
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

<form onsubmit={handleSubmit}>
	<label>
		Name
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
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
		<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Saving…' : submitLabel}</button>
	</div>
</form>

{#if mode === 'edit' && individualIri}
	<div class="assertions">
		<h4>Assertions</h4>
		<ul class="assertion-list">
			{#each assertions as a (a.predicateIri + a.objectIri)}
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
						{#each predicateOptions as p (p.iri)}
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
		width: 22px;
		height: 22px;
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
