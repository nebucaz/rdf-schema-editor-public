<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type FetchedSchema } from '$lib/services/sparql-connector';
	import { settingsStore } from '$lib/stores/settings-store.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { extractLocalName } from '$lib/utils/iri';
	import { erdSourceMarkerStore } from '$lib/stores/erd-source-marker-store.svelte';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';

	let loadError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let saveSuccess = $state(false);
	let saveBusy = $state(false);
	let schema = $state<FetchedSchema | null>(null);
	let selected = $state<string>('');
	// selectedRepresentsPredicate (Backstage-sync STORY-104) — the represents-predicate picker's own
	// bound value, saved together with the catalog-marker-class picker above by one shared Save button.
	let selectedRepresentsPredicate = $state<string>('');

	// objectProperties (STORY-104) — every declared `owl:ObjectProperty`, not just the subset
	// `schema.objectProperties` surfaces (that list is scoped to properties currently wired into the
	// canvas: `fetchAllObjectProperties` requires rdfs:domain/range, `fetchGenericObjectPropertyEdges`
	// requires a live `sh:property` shape reference). This picker's target may be declared but not
	// yet attached to any entity, so it needs `fetchAllDeclaredObjectProperties`'s unfiltered list
	// instead — see that method's own doc comment.
	let objectProperties = $state<{ iri: string; label: string; namespaceBaseIri: string }[]>([]);

	onMount(async () => {
		loadError = null;
		try {
			await namespaceStore.ensureLoaded();
			await settingsStore.ensureLoaded();
			[schema, objectProperties] = await Promise.all([
				sparqlConnector.fetchFullSchemaForAllNamespaces(),
				sparqlConnector.fetchAllDeclaredObjectProperties()
			]);
			selected = settingsStore.authoritativeEntityClassIri ?? '';
			selectedRepresentsPredicate = settingsStore.representsPredicateIri ?? '';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load settings';
		}
	});

	function prefixOf(namespaceBaseIri: string): string {
		return namespaceStore.namespaces.find((ns) => ns.baseIri === namespaceBaseIri)?.prefix ?? namespaceBaseIri;
	}

	/** Saves both settings together behind one Save button — there's no independent-save use case
	 *  worth the two-button UI these were previously split across. */
	async function handleSave() {
		saveError = null;
		saveSuccess = false;
		saveBusy = true;
		try {
			await Promise.all([
				sparqlConnector.setAuthoritativeEntityClassIri(selected || null),
				sparqlConnector.setRepresentsPredicateIri(selectedRepresentsPredicate || null)
			]);
			await settingsStore.refresh();
			workbenchActions.reload();
			saveSuccess = true;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save settings';
		} finally {
			saveBusy = false;
		}
	}

	// Editing either field after a save invalidates the "Saved" confirmation — it describes the
	// settings as they were at save time, not the picker's current (unsaved) value.
	function clearSaveSuccess() {
		saveSuccess = false;
	}
</script>

<div class="field">
	<label class="checkbox">
		<input
			type="checkbox"
			checked={erdSourceMarkerStore.getSourceMarker()}
			onchange={(e) => erdSourceMarkerStore.setSourceMarker(e.currentTarget.checked)}
		/>
		Crow's Foot export: mark the source end of relations
	</label>
	<p class="hint">
		Adds the standard <code>0..*</code> symbol (any number of sources may reference one target) at the
		start of each relation line in exported Crow's Foot diagrams. Off by default — it adds visual noise.
		Saved in this browser, immediately.
	</p>
</div>

{#if loadError}
	<p class="error">{loadError}</p>
{:else if !schema || settingsStore.loading}
	<p class="status">Loading settings…</p>
{:else}
	<div class="field">
		<label for="catalog-marker-class">Catalog marker class</label>
		<p class="hint">
			Classes declared <code>rdfs:subClassOf</code> this class are eligible for DCAT catalog generation
			and the Provenance report, and their direct subclasses require a Concept namespace to be set.
		</p>
		<select id="catalog-marker-class" bind:value={selected} onchange={clearSaveSuccess}>
			<option value="">— None —</option>
			{#each schema.classes as c (c.iri)}
				<option value={c.iri}>[{prefixOf(c.namespaceBaseIri)}] {c.label || extractLocalName(c.iri)}</option>
			{/each}
		</select>
	</div>

	<div class="field">
		<label for="represents-predicate">Represents predicate</label>
		<p class="hint">
			The <code>owl:ObjectProperty</code> a Backstage-synced individual's <code>represents</code> link
			(pointing at the business individual named by its <code>enterprise.catalog.iri</code> annotation)
			is written with.
		</p>
		<select
			id="represents-predicate"
			bind:value={selectedRepresentsPredicate}
			onchange={clearSaveSuccess}
		>
			<option value="">— None —</option>
			{#each objectProperties as p (p.iri)}
				<option value={p.iri}>[{prefixOf(p.namespaceBaseIri)}] {p.label || extractLocalName(p.iri)}</option>
			{/each}
		</select>
	</div>

	{#if saveError}
		<p class="error" role="alert">Failed to save: {saveError}</p>
	{:else if saveSuccess}
		<p class="success" role="status">Settings saved.</p>
	{/if}

	<button type="button" class="save-button" onclick={() => void handleSave()} disabled={saveBusy}>
		{saveBusy ? 'Saving…' : 'Save'}
	</button>
{/if}

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin-bottom: 1rem;
	}

	label.checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	label {
		font-weight: 600;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	select {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
	}

	.save-button {
		width: 100%;
		padding: 0.5rem 0;
		text-align: center;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-bg);
		background: var(--color-accent);
		border: none;
		border-radius: 6px;
	}

	.save-button:disabled {
		opacity: 0.6;
	}

	.status {
		font-size: 0.9rem;
		color: var(--color-text-muted);
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.success {
		color: var(--color-success);
		background: var(--color-success-bg);
		padding: 0.4rem 0.6rem;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
	}
</style>
