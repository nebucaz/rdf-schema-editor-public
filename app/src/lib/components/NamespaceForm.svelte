<script lang="ts">
	import ColorSwatchPicker from './ColorSwatchPicker.svelte';

	import { isWellFormedIri } from '$lib/utils/iri';

	interface Props {
		mode: 'create' | 'edit';
		initialPrefix?: string;
		initialBaseIri?: string;
		initialDescription?: string;
		initialColor?: string;
		/** Default `dct:publisher` (data-catalog Story 011) — a plain literal (organization name). */
		initialPublisher?: string;
		/** Default `dct:license` (data-catalog Story 011) — a well-formed IRI. */
		initialLicense?: string;
		/** Locks the namespace against deletion, even forced (STORY-095). Edit mode only. */
		initialLocked?: boolean;
		/** Starts the namespace hidden by default for a browser that's never toggled it
		 *  (STORY-096). Edit mode only. */
		initialDefaultHidden?: boolean;
		/** Whether the namespace appears as a togglable row in the namespace filter (STORY-097).
		 *  Edit mode only, defaults to shown. */
		initialListedInFilter?: boolean;
		submitLabel: string;
		onSubmit: (values: {
			prefix: string;
			baseIri: string;
			description: string;
			color: string | undefined;
			publisher: string;
			license: string;
			locked: boolean;
			defaultHidden: boolean;
			listedInFilter: boolean;
		}) => Promise<void>;
		onCancel: () => void;
	}

	let {
		mode,
		initialPrefix = '',
		initialBaseIri = '',
		initialDescription = '',
		initialColor,
		initialPublisher = '',
		initialLicense = '',
		initialLocked = false,
		initialDefaultHidden = false,
		initialListedInFilter = true,
		submitLabel,
		onSubmit,
		onCancel
	}: Props = $props();

	let prefix = $state(initialPrefix);
	let baseIri = $state(initialBaseIri);
	let description = $state(initialDescription);
	let color = $state<string | undefined>(initialColor);
	let publisher = $state(initialPublisher);
	let license = $state(initialLicense);
	let locked = $state(initialLocked);
	let defaultHidden = $state(initialDefaultHidden);
	let listedInFilter = $state(initialListedInFilter);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (mode === 'create') {
			if (!prefix.trim()) {
				error = 'Prefix must not be empty';
				return;
			}
			if (!baseIri.trim()) {
				error = 'Base IRI must not be empty';
				return;
			}
		}
		if (license.trim() && !isWellFormedIri(license.trim())) {
			error = 'License must be a well-formed IRI (e.g. https://example.com/license/...)';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit({
				prefix: prefix.trim(),
				baseIri: baseIri.trim(),
				description: description.trim(),
				color,
				publisher: publisher.trim(),
				license: license.trim(),
				locked,
				defaultHidden,
				listedInFilter
			});
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Prefix
		{#if mode === 'create'}
			<input type="text" bind:value={prefix} placeholder="e.g. gov" />
		{:else}
			<input type="text" value={prefix} readonly disabled />
		{/if}
	</label>
	<label>
		Base IRI
		{#if mode === 'create'}
			<input type="text" bind:value={baseIri} placeholder="e.g. http://example.com/gov" />
		{:else}
			<input type="text" value={baseIri} readonly disabled />
		{/if}
	</label>
	<label>
		Description
		<textarea bind:value={description} placeholder="Optional description" rows="3"></textarea>
	</label>
	<label>
		Default color
		<ColorSwatchPicker {color} onChange={(c) => (color = c)} />
	</label>
	<label>
		Default publisher (dct:publisher)
		<input type="text" bind:value={publisher} placeholder="Optional — organization name" />
	</label>
	<label>
		Default license (dct:license)
		<input type="text" bind:value={license} placeholder="Optional — a license IRI" />
	</label>
	{#if mode === 'edit'}
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={locked} />
			Locked (blocks deletion, even forced, until unlocked)
		</label>
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={defaultHidden} />
			Starts hidden by default for browsers that haven't toggled it
		</label>
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={listedInFilter} />
			Show in namespace filter
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
	textarea {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	input:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.checkbox-label input[type='checkbox'] {
		width: auto;
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
</style>
