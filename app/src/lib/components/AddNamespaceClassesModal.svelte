<script lang="ts">
	import Modal from './Modal.svelte';
	import { classesOfNamespace } from '$lib/services/namespace-class-placement';
	import type { FetchedNamespace, FetchedSchema } from '$lib/services/sparql-connector';

	interface Props {
		isOpen: boolean;
		/** The loaded schema (`lastFetchedSchema`); null before the first load finishes. */
		schema: FetchedSchema | null;
		namespaces: FetchedNamespace[];
		/** Element IRIs already on the active workspace. */
		workspaceMembers: ReadonlySet<string>;
		initialNamespaceBaseIri?: string;
		onConfirm: (classIris: string[]) => void;
		onClose: () => void;
	}

	let { isOpen, schema, namespaces, workspaceMembers, initialNamespaceBaseIri, onConfirm, onClose }: Props = $props();

	let namespaceBaseIri = $state('');
	/** Classes the user unticked; everything addable is ticked by default. */
	let unticked = $state<Set<string>>(new Set());

	// A fresh dialog each time it opens.
	$effect(() => {
		if (isOpen) {
			namespaceBaseIri = initialNamespaceBaseIri ?? '';
			unticked = new Set();
		}
	});

	let rows = $derived(
		schema && namespaceBaseIri ? classesOfNamespace(schema, namespaceBaseIri, workspaceMembers) : []
	);
	let addable = $derived(rows.filter((r) => !r.alreadyOnWorkspace));
	let selected = $derived(addable.filter((r) => !unticked.has(r.iri)).map((r) => r.iri));
	let allSelected = $derived(addable.length > 0 && selected.length === addable.length);

	function selectNamespace(value: string) {
		namespaceBaseIri = value;
		unticked = new Set();
	}

	function toggle(iri: string) {
		const next = new Set(unticked);
		if (next.has(iri)) next.delete(iri);
		else next.add(iri);
		unticked = next;
	}

	function toggleAll() {
		unticked = allSelected ? new Set(addable.map((r) => r.iri)) : new Set();
	}
</script>

<Modal {isOpen} title="Add entities from namespace" {onClose} maxWidth="560px">
	<div class="body">
		<label class="field">
			<span>Namespace</span>
			<select value={namespaceBaseIri} onchange={(e) => selectNamespace(e.currentTarget.value)}>
				<option value="">Choose a namespace…</option>
				{#each namespaces as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix ? `${ns.prefix} — ${ns.baseIri}` : ns.baseIri}</option>
				{/each}
			</select>
		</label>

		{#if namespaceBaseIri}
			{#if rows.length === 0}
				<p class="empty">No classes in this namespace.</p>
			{:else}
				<div class="list-head">
					<span class="count">{rows.length} {rows.length === 1 ? 'class' : 'classes'}</span>
					<button type="button" class="link" onclick={toggleAll} disabled={addable.length === 0}>
						{allSelected ? 'Select none' : 'Select all'}
					</button>
				</div>
				<ul class="classes" data-testid="namespace-class-list">
					{#each rows as row (row.iri)}
						<li class:existing={row.alreadyOnWorkspace}>
							<label>
								<input
									type="checkbox"
									checked={!row.alreadyOnWorkspace && !unticked.has(row.iri)}
									disabled={row.alreadyOnWorkspace}
									onchange={() => toggle(row.iri)}
								/>
								<span class="name">{row.label}</span>
								{#if row.alreadyOnWorkspace}<span class="hint">already on workspace</span>{/if}
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<div class="actions">
			<button type="button" onclick={onClose}>Cancel</button>
			<button
				type="button"
				class="primary"
				data-testid="add-namespace-classes-confirm"
				disabled={selected.length === 0}
				onclick={() => onConfirm(selected)}
			>
				Add {selected.length} {selected.length === 1 ? 'class' : 'classes'}
			</button>
		</div>
	</div>
</Modal>

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: var(--color-text);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	select {
		padding: 0.4rem 0.5rem;
		background: var(--color-bg);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}
	.list-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: var(--color-accent);
		cursor: pointer;
		font: inherit;
	}
	.link:disabled {
		color: var(--color-text-muted);
		cursor: default;
	}
	.classes {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 18rem;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}
	.classes li label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.6rem;
		cursor: pointer;
	}
	.classes li:hover {
		background: var(--color-hover);
	}
	.classes li.existing label {
		cursor: default;
		color: var(--color-text-muted);
	}
	.hint {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
	.empty {
		margin: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.actions button {
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}
	.actions .primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
