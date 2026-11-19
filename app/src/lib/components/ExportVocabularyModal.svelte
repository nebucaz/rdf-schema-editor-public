<script lang="ts">
	/** Export dialog of the Vocabulary page (skos-support STORY-414): scope, format and options. Presentational:
	 *  it hands the chosen settings to `onExport`; building and downloading the files is the page's job.
	 *  Options that only apply to Turtle are disabled for CSV, never silently ignored. */
	import Modal from './Modal.svelte';
	import { DEFAULT_EXPORT_SETTINGS, type ExportSettings } from '#lib/services/skos-export-actions.js';
	import { schemeDisplayName, type ConceptScheme } from '#lib/services/skos-concept.js';

	interface Props {
		isOpen: boolean;
		schemes: ConceptScheme[];
		onExport: (settings: ExportSettings) => void;
		onClose: () => void;
	}

	let { isOpen, schemes, onExport, onClose }: Props = $props();

	let settings = $state<ExportSettings>({ ...DEFAULT_EXPORT_SETTINGS });
	const turtleOnly = $derived(settings.format !== 'turtle');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onExport(
			turtleOnly
				? { ...settings, includeEditorialNotes: false, includeProjectPredicates: false, classExactMatch: false, includeShapes: false }
				: { ...settings }
		);
	}
</script>

<Modal {isOpen} title="Export vocabulary" {onClose} maxWidth="480px">
	<form onsubmit={submit}>
		<label>
			Scope
			<select bind:value={settings.schemeIri}>
				<option value="">All schemes</option>
				{#each schemes as s (s.iri)}
					<option value={s.iri}>{schemeDisplayName(s)}</option>
				{/each}
			</select>
		</label>
		<fieldset>
			<legend>Format</legend>
			<label class="inline"><input type="radio" name="format" value="turtle" bind:group={settings.format} /> Turtle</label>
			<label class="inline"><input type="radio" name="format" value="csv" bind:group={settings.format} /> CSV</label>
		</fieldset>
		<fieldset>
			<legend>Turtle options</legend>
			<label class="inline"><input type="checkbox" bind:checked={settings.includeEditorialNotes} disabled={turtleOnly} /> Include editorial notes</label>
			<label class="inline"><input type="checkbox" bind:checked={settings.includeProjectPredicates} disabled={turtleOnly} /> Include project predicates</label>
			<label class="inline"><input type="checkbox" bind:checked={settings.classExactMatch} disabled={turtleOnly} /> Add skos:exactMatch from classes to concepts</label>
			<label class="inline"><input type="checkbox" bind:checked={settings.includeShapes} disabled={turtleOnly} /> Include SHACL shapes</label>
		</fieldset>
		{#if turtleOnly}<p class="hint">CSV carries labels, definition, notation, broader and related only.</p>{/if}
		<div class="actions">
			<button type="button" onclick={onClose}>Cancel</button>
			<button type="submit">Export</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}

	fieldset {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.actions button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
	}

	.actions button:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.actions button[type='submit'] {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.actions button[type='submit']:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
</style>
