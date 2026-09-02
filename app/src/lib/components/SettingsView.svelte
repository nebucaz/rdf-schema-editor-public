<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type FetchedSchema } from '$lib/services/sparql-connector';
	import { settingsStore } from '$lib/stores/settings-store.svelte';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { extractLocalName } from '$lib/utils/iri';
	import { workbenchActions } from '$lib/stores/workbench-actions.svelte';

	let loadError = $state<string | null>(null);
	let saveError = $state<string | null>(null);
	let saveBusy = $state(false);
	let schema = $state<FetchedSchema | null>(null);
	let selected = $state<string>('');

	onMount(async () => {
		loadError = null;
		try {
			await namespaceStore.ensureLoaded();
			await settingsStore.ensureLoaded();
			schema = await sparqlConnector.fetchFullSchemaForAllNamespaces();
			selected = settingsStore.authoritativeEntityClassIri ?? '';
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load settings';
		}
	});

	function prefixOf(namespaceBaseIri: string): string {
		return namespaceStore.namespaces.find((ns) => ns.baseIri === namespaceBaseIri)?.prefix ?? namespaceBaseIri;
	}

	async function handleSave() {
		saveError = null;
		saveBusy = true;
		try {
			await sparqlConnector.setAuthoritativeEntityClassIri(selected || null);
			await settingsStore.refresh();
			workbenchActions.reload();
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save settings';
		} finally {
			saveBusy = false;
		}
	}
</script>

{#if loadError}
	<p class="error">{loadError}</p>
{:else if !schema || settingsStore.loading}
	<p class="status">Loading settings…</p>
{:else}
	<div class="field">
		<label for="catalog-marker-class">Catalog marker class</label>
		<p class="hint">
			Classes declared <code>rdfs:subClassOf</code> this class are eligible for DCAT catalog generation
			and the Provenance report.
		</p>
		<select id="catalog-marker-class" bind:value={selected}>
			<option value="">— None —</option>
			{#each schema.classes as c (c.iri)}
				<option value={c.iri}>[{prefixOf(c.namespaceBaseIri)}] {c.label || extractLocalName(c.iri)}</option>
			{/each}
		</select>
	</div>

	{#if saveError}
		<p class="error">{saveError}</p>
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
</style>
