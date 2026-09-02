<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type FetchedNamespace } from '$lib/services/sparql-connector';
	import { pascalCase } from '$lib/utils/iri';

	/**
	 * Story 006: lists every Backstage `kind` the live catalog has that no local class maps to yet
	 * (via `GET /api/sources/backstage/discover`, proxying the Go backend's source-parameterized
	 * discovery endpoint), with a one-click way to either dismiss it (model it manually later) or
	 * create-and-tag a class for it in one atomic connector call.
	 */
	interface Props {
		namespaces: FetchedNamespace[];
		/** Called after a class is successfully created, so the caller can refresh the canvas/schema
		 *  (`workbenchActions.reload()`). */
		onCreated: () => void;
	}

	let { namespaces, onCreated }: Props = $props();

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let unmappedKinds = $state<string[]>([]);
	// STORY-006: dismissal is session-only, never persisted — the mapping's own absence/presence in
	// the graph is the only state that matters, so re-running discovery re-surfaces a dismissed kind.
	let dismissed = $state<Set<string>>(new Set());

	let createTarget = $state<string | null>(null);
	let createNamespaceBaseIri = $state('');
	let createClassName = $state('');
	let createError = $state<string | null>(null);
	let creating = $state(false);

	const visibleKinds = $derived(unmappedKinds.filter((k) => !dismissed.has(k)));

	async function loadDiscovery() {
		loading = true;
		loadError = null;
		try {
			const response = await fetch('/api/sources/backstage/discover');
			if (!response.ok) {
				throw new Error(`Discovery failed: ${response.status} ${response.statusText}`);
			}
			const data = await response.json();
			unmappedKinds = Array.isArray(data.unmappedKinds) ? data.unmappedKinds : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load missing concepts';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void loadDiscovery();
	});

	function dismiss(kind: string) {
		dismissed = new Set([...dismissed, kind]);
	}

	function openCreateForm(kind: string) {
		createTarget = kind;
		createNamespaceBaseIri = ''; // No default — namespace choice is always an explicit decision.
		createClassName = pascalCase(kind);
		createError = null;
	}

	function cancelCreateForm() {
		createTarget = null;
		createError = null;
	}

	async function handleCreateSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!createTarget) return;
		if (!createNamespaceBaseIri) {
			createError = 'Choose a namespace';
			return;
		}
		if (!createClassName.trim()) {
			createError = 'Class name must not be empty';
			return;
		}
		creating = true;
		createError = null;
		try {
			await sparqlConnector.insertClassAndSetBackstageKind(
				createClassName.trim(),
				createTarget,
				createNamespaceBaseIri
			);
			dismissed = new Set([...dismissed, createTarget]);
			createTarget = null;
			onCreated();
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Failed to create class';
		} finally {
			creating = false;
		}
	}
</script>

<div class="panel">
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if loadError}
		<p class="error">{loadError}</p>
	{:else if visibleKinds.length === 0}
		<p class="hint">No missing concepts — every Backstage kind in the live catalog maps to a local class.</p>
	{:else}
		<ul class="kind-list">
			{#each visibleKinds as kind (kind)}
				<li class="kind-row">
					<span class="kind-name">{kind}</span>
					{#if createTarget === kind}
						<form class="create-form" onsubmit={handleCreateSubmit}>
							<label>
								Namespace
								<select bind:value={createNamespaceBaseIri}>
									<option value="" disabled>Choose…</option>
									{#each namespaces as ns (ns.baseIri)}
										<option value={ns.baseIri}>{ns.prefix}</option>
									{/each}
								</select>
							</label>
							<label>
								Class name
								<input type="text" bind:value={createClassName} autocomplete="off" />
							</label>
							{#if createError}
								<p class="error">{createError}</p>
							{/if}
							<div class="actions">
								<button type="button" class="secondary" onclick={cancelCreateForm} disabled={creating}>
									Cancel
								</button>
								<button type="submit" class="primary" disabled={creating}>
									{creating ? 'Creating…' : 'Create'}
								</button>
							</div>
						</form>
					{:else}
						<div class="actions">
							<button type="button" class="secondary" onclick={() => dismiss(kind)}>
								I'll model this myself
							</button>
							<button type="button" class="primary" onclick={() => openCreateForm(kind)}>
								Create class now
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 320px;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.kind-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.kind-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}

	.kind-name {
		font-weight: 600;
		font-family: 'SF Mono', Menlo, Consolas, monospace;
	}

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.create-form label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.create-form input,
	.create-form select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
		border: none;
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
