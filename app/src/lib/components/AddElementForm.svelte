<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type NameableEntity } from '$lib/services/sparql-connector';

	interface Props {
		/** Calls `addWorkspaceMember` for the active Workspace — never a connector method that could
		 *  mint a new class/individual (STORY-080 AC). Resolves to whether the element was already a
		 *  member before this call, so the form can confirm rather than error on a repeat pick. */
		onAdd: (iri: string) => Promise<{ alreadyMember: boolean }>;
		onClose: () => void;
	}

	let { onAdd, onClose }: Props = $props();

	let options = $state<NameableEntity[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let label = $state('');
	let error = $state<string | null>(null);
	let status = $state<string | null>(null);
	let submitting = $state(false);

	const kindLabels: Record<'class' | 'individual', string> = { class: 'Class', individual: 'Individual' };

	onMount(async () => {
		try {
			options = await sparqlConnector.fetchAddableWorkspaceElements();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load classes/individuals';
		} finally {
			loading = false;
		}
	});

	/** No free-text submit path (STORY-080 AC): only a label that exactly matches one of the
	 *  `<datalist>` options resolves to an addable IRI. */
	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = label.trim();
		const match = options.find((o) => o.label === trimmed);
		if (!match) {
			error = 'Select an existing class or individual from the list.';
			status = null;
			return;
		}
		error = null;
		submitting = true;
		try {
			const { alreadyMember } = await onAdd(match.iri);
			status = alreadyMember ? `${match.label} is already in this workspace.` : `Added ${match.label}.`;
			label = '';
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to add element';
			status = null;
		} finally {
			submitting = false;
		}
	}
</script>

{#if loading}
	<p class="status">Loading…</p>
{:else if loadError}
	<p class="error">{loadError}</p>
{:else}
	<form onsubmit={handleSubmit}>
		<label>
			Class or individual
			<input
				type="text"
				bind:value={label}
				list="add-element-names"
				placeholder="Type a name…"
				autocomplete="off"
			/>
			<datalist id="add-element-names">
				{#each options as o (o.iri)}
					<option value={o.label}>{kindLabels[o.kind as 'class' | 'individual']}</option>
				{/each}
			</datalist>
		</label>
		{#if error}
			<p class="error">{error}</p>
		{/if}
		{#if status}
			<p class="confirmation">{status}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={onClose}>Done</button>
			<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add'}</button>
		</div>
	</form>
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

	input {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.status {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.confirmation {
		color: var(--color-text-muted);
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
