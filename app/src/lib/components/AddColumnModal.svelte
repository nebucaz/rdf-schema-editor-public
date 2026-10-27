<script lang="ts">
	/**
	 * object-browser (STORY-255): the Columns dialog. The body is the multi-pane
	 * `ObjectBrowser`; Apply hands the whole selection (picks, plus existing columns that were unticked)
	 * to `onSave`, which folds it into the model in one step. Nothing is applied until Apply, so
	 * Cancel/Escape/backdrop leave the model untouched.
	 *
	 * `initialTarget` (`'group:root'` / `'group:<hopId>'`) opens the browser on that group's class — the
	 * the Columns entry of a group header; the page's Columns button uses it too (on the root group).
	 */
	import Modal from './Modal.svelte';
	import ObjectBrowser from './ObjectBrowser.svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { FetchedNamespace } from '$lib/services/sparql-connector';
	import type { QueryModel } from '$lib/services/query-model';
	import type { BrowserPick } from '$lib/services/query-object-browser';

	interface Props {
		isOpen: boolean;
		schema: BuilderSchema;
		namespaces: FetchedNamespace[];
		/** The query being extended; `null` = nothing started yet (the browser lists every class). */
		model?: QueryModel | null;
		onSave: (selection: { picks: BrowserPick[]; removeColumnIds: string[] }) => void;
		/** Opens straight on a group: `'group:root'` or `'group:<hopId>'`. */
		initialTarget?: string | null;
		onClose: () => void;
	}

	let { isOpen, schema, namespaces, model = null, onSave, initialTarget = null, onClose }: Props = $props();

	let selection = $state<{ picks: BrowserPick[]; removeColumnIds: string[] }>({ picks: [], removeColumnIds: [] });
	const canSave = $derived(selection.picks.length + selection.removeColumnIds.length > 0);
	const initialHopId = $derived.by(() => {
		if (!model || !initialTarget?.startsWith('group:')) return undefined;
		const id = initialTarget.slice(6);
		return id === 'root' ? null : id;
	});

	// A previous opening's selection never leaks into the next one.
	$effect(() => {
		if (isOpen) selection = { picks: [], removeColumnIds: [] };
	});

	function save() {
		if (canSave) onSave(selection);
	}
</script>

<Modal {isOpen} title="Columns" {onClose} maxWidth="960px">
	<div class="add-column" data-testid="add-column-modal">
		<!-- Mounted only while open, so each opening starts from a clean selection. -->
		{#if isOpen}
			<ObjectBrowser
				{schema}
				{namespaces}
				{model}
				{initialHopId}
				onChange={(next) => (selection = next)}
			/>
		{/if}
		<div class="actions">
			<button type="button" onclick={onClose} data-testid="add-column-cancel">Cancel</button>
			<button type="button" class="primary" disabled={!canSave} onclick={save} data-testid="add-column-save">
				Apply
			</button>
		</div>
	</div>
</Modal>

<style>
	.add-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
