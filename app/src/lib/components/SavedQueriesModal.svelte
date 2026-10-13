<script lang="ts">
	/**
	 * Saved-query picker (modal): choose a query to open it in the builder, or delete one (with an
	 * inline confirmation). Raw-SPARQL legacy queries are filtered out by the caller.
	 */
	import Modal from './Modal.svelte';
	import { filterCreatedByMe, type SavedQueryItem, type WorkbenchUser } from '$lib/services/saved-queries';

	interface Props {
		isOpen: boolean;
		items: SavedQueryItem[];
		user: WorkbenchUser | null;
		error: string | null;
		loading: boolean;
		onOpen: (item: SavedQueryItem) => void;
		onDelete: (iri: string) => Promise<boolean>;
		onClose: () => void;
	}

	let { isOpen, items, user, error, loading, onOpen, onDelete, onClose }: Props = $props();

	let onlyMine = $state(false);
	let deletingIri = $state<string | null>(null);

	const visible = $derived(filterCreatedByMe(items, onlyMine));

	async function confirmDelete(iri: string) {
		if (await onDelete(iri)) deletingIri = null;
	}

	function open(item: SavedQueryItem) {
		deletingIri = null;
		onOpen(item);
		onClose();
	}
</script>

<Modal {isOpen} title="Saved queries" {onClose} maxWidth="640px">
	<div class="saved" data-testid="saved-queries">
		{#if user}
			<label class="mine"><input type="checkbox" bind:checked={onlyMine} /> Created by me</label>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}

		{#if loading && items.length === 0}
			<p class="meta">Loading…</p>
		{:else if visible.length === 0}
			<p class="meta">No saved queries yet.</p>
		{:else}
			<ul class="list">
				{#each visible as item (item.iri)}
					<li data-testid="saved-query-row">
						<div class="info">
							<span class="name">{item.label}</span>
							{#if item.creator}<span class="meta">by {item.creator}</span>{/if}
							{#if item.description}<span class="meta description">{item.description}</span>{/if}
						</div>
						<span class="actions">
							{#if deletingIri === item.iri}
								<span>Delete “{item.label}”?</span>
								<button type="button" onclick={() => confirmDelete(item.iri)}>Confirm</button>
								<button type="button" onclick={() => (deletingIri = null)}>Cancel</button>
							{:else}
								<button type="button" onclick={() => open(item)} data-testid="open-saved-query">Open</button>
								<button type="button" onclick={() => (deletingIri = item.iri)}>Delete</button>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Modal>

<style>
	.list {
		list-style: none;
		margin: 0.5rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 60vh;
		overflow-y: auto;
	}
	.list li {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--color-border);
	}
	.info {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.actions {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-shrink: 0;
	}
	.name {
		font-weight: 600;
	}
	.meta {
		font-size: 0.8rem;
		opacity: 0.7;
	}
	.mine {
		display: block;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-danger, #b00020);
	}
</style>
