<script lang="ts">
	import MemberForm from './MemberForm.svelte';
	import type { EntityMemberVM } from './EntityNode.svelte';

	interface Props {
		members: EntityMemberVM[];
		onAdd: (label: string) => Promise<void>;
		onEdit: (member: EntityMemberVM, label: string) => Promise<void>;
		onDelete: (member: EntityMemberVM) => Promise<void>;
	}

	let { members, onAdd, onEdit, onDelete }: Props = $props();

	/** `MemberForm` (per Decision 5) is wrapped inline here rather than opened as a second stacked
	 *  `Modal` — exactly one of `showAddForm`/`editTarget` is truthy while the add/edit form is
	 *  showing; both `false`/`null` means the list view. */
	let showAddForm = $state(false);
	let editTarget = $state<EntityMemberVM | null>(null);
	let deleteTarget = $state<EntityMemberVM | null>(null);
	let deleteBusy = $state(false);
	let error = $state<string | null>(null);

	async function handleAddSubmit(label: string) {
		await onAdd(label);
		showAddForm = false;
	}

	async function handleEditSubmit(member: EntityMemberVM, label: string) {
		await onEdit(member, label);
		editTarget = null;
	}

	async function handleDeleteConfirm() {
		if (!deleteTarget) return;
		deleteBusy = true;
		error = null;
		try {
			await onDelete(deleteTarget);
			deleteTarget = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete member';
		} finally {
			deleteBusy = false;
		}
	}
</script>

{#if showAddForm}
	<MemberForm submitLabel="Add" onCancel={() => (showAddForm = false)} onSubmit={handleAddSubmit} />
{:else if editTarget}
	{@const target = editTarget}
	<MemberForm
		initialLabel={target.label}
		submitLabel="Save"
		onCancel={() => (editTarget = null)}
		onSubmit={(label) => handleEditSubmit(target, label)}
	/>
{:else}
	<ul class="members">
		{#each members as member (member.iri)}
			<li>
				<span class="member-name">{member.label}</span>
				<span class="member-actions">
					<button
						class="icon-button"
						onclick={() => (editTarget = member)}
						aria-label={`Edit ${member.label}`}
						title="Edit"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
					</button>
					<button
						class="icon-button"
						onclick={() => (deleteTarget = member)}
						aria-label={`Delete ${member.label}`}
						title="Delete"
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				</span>
			</li>
		{:else}
			<li class="empty">No members yet.</li>
		{/each}
	</ul>

	{#if deleteTarget}
		<div class="delete-confirm">
			<p>Delete member <strong>{deleteTarget.label}</strong>? This cannot be undone.</p>
			{#if error}
				<p class="error">{error}</p>
			{/if}
			<div class="actions">
				<button type="button" class="secondary" onclick={() => (deleteTarget = null)} disabled={deleteBusy}>
					Cancel
				</button>
				<button type="button" class="danger" onclick={handleDeleteConfirm} disabled={deleteBusy}>
					{deleteBusy ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</div>
	{:else}
		<button type="button" class="add-member" onclick={() => (showAddForm = true)}>+ Add member</button>
	{/if}
{/if}

<style>
	.members {
		list-style: none;
		margin: 0 0 0.75rem;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.members li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border);
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.members li:first-child {
		border-top: none;
	}

	.members li.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.member-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.member-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		border: none;
	}

	.icon-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
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

	.delete-confirm p {
		font-size: 0.9rem;
		color: var(--color-text);
		margin: 0 0 0.75rem;
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

	.actions button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	.danger {
		background: var(--color-error);
		color: #fff;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
