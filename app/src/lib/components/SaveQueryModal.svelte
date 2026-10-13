<script lang="ts">
	/** Save form (modal): name + optional description, Save / Cancel. */
	import Modal from './Modal.svelte';

	interface Props {
		isOpen: boolean;
		/** Why saving is currently impossible (e.g. no user identity), or `null`. */
		disabledReason: string | null;
		onSave: (name: string, description: string) => Promise<boolean>;
		onClose: () => void;
	}

	let { isOpen, disabledReason, onSave, onClose }: Props = $props();

	let name = $state('');
	let description = $state('');
	let saving = $state(false);

	async function submit(event: Event) {
		event.preventDefault();
		if (disabledReason || !name.trim() || saving) return;
		saving = true;
		try {
			if (await onSave(name.trim(), description.trim())) {
				name = '';
				description = '';
				onClose();
			}
		} finally {
			saving = false;
		}
	}

	function cancel() {
		name = '';
		description = '';
		onClose();
	}
</script>

<Modal {isOpen} title="Save query" onClose={cancel} dismissible={false}>
	<form class="save-form" onsubmit={submit} data-testid="save-query-form">
		{#if disabledReason}
			<p class="error" role="status" data-testid="save-disabled-reason">{disabledReason}</p>
		{/if}
		<label>
			Name
			<input bind:value={name} disabled={!!disabledReason} data-testid="save-query-name" />
		</label>
		<label>
			Description (optional)
			<textarea rows="3" bind:value={description} disabled={!!disabledReason}></textarea>
		</label>
		<div class="buttons">
			<button type="button" onclick={cancel}>Cancel</button>
			<button type="submit" disabled={!!disabledReason || !name.trim() || saving} data-testid="save-query">
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</form>
</Modal>

<style>
	.save-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	input,
	textarea {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.error {
		margin: 0;
		color: var(--color-danger, #b00020);
	}
</style>
