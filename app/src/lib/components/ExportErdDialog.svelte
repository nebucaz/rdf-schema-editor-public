<script lang="ts" module>
	import type { Notation } from '$lib/services/erd-layout';
	import type { ErdExportFormat } from '$lib/utils/erd-export-prefs';

	export interface ExportErdChoice {
		notation: Notation;
		legend: boolean;
		format: ErdExportFormat;
		/** Export only the selected entities (always false when nothing is selected). */
		selectionOnly: boolean;
	}
</script>

<script lang="ts">
	import Modal from './Modal.svelte';
	import { NOTATIONS, readErdExportPrefs, writeErdExportPrefs } from '$lib/utils/erd-export-prefs';

	interface Props {
		isOpen: boolean;
		busy?: boolean;
		/** Number of selected canvas nodes — the "Selection only" option is offered when > 0. */
		selectionCount?: number;
		onExport: (choice: ExportErdChoice) => void;
		onClose: () => void;
	}

	let { isOpen, busy = false, selectionCount = 0, onExport, onClose }: Props = $props();

	const LABELS: Record<Notation, string> = { 'crows-foot': "Crow's Foot", chen: 'Chen', uml: 'UML' };

	const initial = readErdExportPrefs();
	let notation = $state<Notation>(initial.notation);
	let legend = $state(initial.legend);
	let format = $state<ErdExportFormat>(initial.format);
	// Default on whenever a selection exists; not persisted (it depends on the current canvas).
	let selectionOnly = $state(true);

	function submit(event: SubmitEvent) {
		event.preventDefault();
		writeErdExportPrefs({ notation, legend, format });
		onExport({ notation, legend, format, selectionOnly: selectionCount > 0 && selectionOnly });
	}
</script>

<Modal {isOpen} title="Export ERD" {onClose}>
	<form onsubmit={submit}>
		<fieldset>
			<legend>Notation</legend>
			{#each NOTATIONS as n (n)}
				<label class="choice">
					<input type="radio" name="erd-notation" value={n} bind:group={notation} />
					{LABELS[n]}
				</label>
			{/each}
		</fieldset>
		<fieldset>
			<legend>Format</legend>
			<label class="choice"><input type="radio" name="erd-format" value="svg" bind:group={format} /> SVG (vector)</label>
			<label class="choice"><input type="radio" name="erd-format" value="png" bind:group={format} /> PNG (2× raster)</label>
		</fieldset>
		<label class="choice">
			<input type="checkbox" bind:checked={legend} />
			Include legend
		</label>
		{#if selectionCount > 0}
			<label class="choice">
				<input type="checkbox" bind:checked={selectionOnly} />
				Selection only ({selectionCount} selected)
			</label>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={onClose} disabled={busy}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>{busy ? 'Exporting…' : 'Export'}</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	fieldset {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	legend {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		padding: 0 0.25rem;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: var(--color-text);
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
