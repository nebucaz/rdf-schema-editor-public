<script lang="ts">
	/**
	 * "Import Turtle" dialog: the user picks the target graph (a registered namespace — never the
	 * bookkeeping one) and then drops a `.ttl` file on the upload field, or clicks it to open the
	 * file chooser. The import starts as soon as a file is chosen, and only once a target is picked,
	 * so an import can no longer land in a namespace nobody chose (the active-namespace `<select>`
	 * only exists on the canvas route).
	 */
	import Modal from './Modal.svelte';
	import { importTargetOptions, initialImportTarget, isTurtleFileName } from '$lib/utils/import-target';

	interface Props {
		isOpen: boolean;
		namespaces: { baseIri: string; prefix: string }[];
		/** Namespace to preselect (the canvas's active namespace), if it is a valid target. */
		activeNamespace: string | null;
		/** Namespace that is never offered (the bookkeeping `rse` namespace). */
		excludeBaseIri: string;
		importing?: boolean;
		onImport: (file: File, namespaceBaseIri: string) => void;
		onClose: () => void;
	}

	let { isOpen, namespaces, activeNamespace, excludeBaseIri, importing = false, onImport, onClose }: Props =
		$props();

	const options = $derived(importTargetOptions(namespaces, excludeBaseIri));

	let chosen = $state<string | null>(null);
	let dragging = $state(false);
	let fileError = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | undefined>();

	// Re-seed the selection each time the dialog opens, so a stale choice never carries over.
	$effect(() => {
		if (isOpen) {
			chosen = initialImportTarget(options, activeNamespace);
			fileError = null;
			dragging = false;
		}
	});

	const target = $derived(chosen !== null && options.some((o) => o.baseIri === chosen) ? chosen : null);
	const canUpload = $derived(target !== null && !importing);

	function accept(file: File | undefined) {
		if (!file || target === null) return;
		if (!isTurtleFileName(file.name)) {
			fileError = `"${file.name}" is not a Turtle file (.ttl).`;
			return;
		}
		fileError = null;
		onImport(file, target);
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		if (canUpload) accept(event.dataTransfer?.files?.[0]);
	}

	function handleInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow choosing the same file again
		accept(file);
	}

	function openChooser() {
		if (canUpload) fileInput?.click();
	}
</script>

<Modal {isOpen} title="Import Turtle" {onClose}>
	{#if options.length === 0}
		<p class="hint" data-testid="import-no-target">
			No namespace to import into. Create one under Namespaces first.
		</p>
	{:else}
		<label class="field">
			<span>Target graph</span>
			<select bind:value={chosen} data-testid="import-target" disabled={importing}>
				<option value={null}>Select a namespace…</option>
				{#each options as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix} — {ns.baseIri}</option>
				{/each}
			</select>
		</label>
		<p class="hint">
			Schema, shapes and data in the file are written to this namespace's graphs, unless a subject
			already exists in another namespace.
		</p>

		<div
			class="dropzone"
			class:dragging
			class:disabled={!canUpload}
			role="button"
			tabindex={canUpload ? 0 : -1}
			aria-disabled={!canUpload}
			aria-label="Upload a Turtle file: drop it here or press to choose"
			data-testid="import-dropzone"
			onclick={openChooser}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					openChooser();
				}
			}}
			ondragover={(e) => {
				e.preventDefault();
				if (canUpload) dragging = true;
			}}
			ondragleave={() => (dragging = false)}
			ondrop={handleDrop}
		>
			{#if importing}
				Importing…
			{:else if target === null}
				Select a target graph first
			{:else}
				Drop a .ttl file here, or click to choose one
			{/if}
		</div>
		{#if fileError}<p class="error" role="alert">{fileError}</p>{/if}
		<input
			bind:this={fileInput}
			type="file"
			accept=".ttl"
			class="file-input"
			data-testid="import-file-input"
			onchange={handleInput}
		/>
	{/if}
</Modal>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	select {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.hint {
		font-size: 0.8rem;
		opacity: 0.75;
		margin: 0.5rem 0 1rem;
	}
	.dropzone {
		border: 2px dashed var(--color-border);
		border-radius: 8px;
		padding: 2rem 1rem;
		text-align: center;
		cursor: pointer;
	}
	.dropzone.dragging {
		border-color: var(--color-text);
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}
	.dropzone.disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}
	.error {
		color: var(--color-error, #c0392b);
		font-size: 0.85rem;
	}
	.file-input {
		display: none;
	}
</style>
