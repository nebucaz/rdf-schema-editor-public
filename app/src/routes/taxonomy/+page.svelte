<script lang="ts">
	/** The taxonomy (ontology-pipeline STORY-328): the `skos:broader` outline of each scheme beside the read-only
	 *  class hierarchy of one namespace. Stage 3 of the pipeline. Each drop or top-concept change is one write,
	 *  followed by a reload of the concepts. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import TaxonomyOutline from '#lib/components/TaxonomyOutline.svelte';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '#lib/config.js';
	import type { Concept, ConceptScheme } from '#lib/services/skos-concept.js';
	import { runGates } from '#lib/services/gates/index.js';
	import { sparqlConnector, type FetchedSchema } from '#lib/services/sparql-connector.js';
	import { buildClassTree, type TaxonomyNode } from '#lib/services/taxonomy-tree.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';
	import { appUrl } from '#lib/utils/urls.js';

	/** `undefined` while loading, `null` when no namespace is marked as the vocabulary yet. */
	let core = $state<string | null | undefined>(undefined);
	let concepts = $state<Concept[]>([]);
	let schemes = $state<ConceptScheme[]>([]);
	let classTree = $state<TaxonomyNode[]>([]);
	let schema = $state<FetchedSchema | null>(null);
	let classNamespace = $state(DEFAULT_NAMESPACE_BASE_IRI);
	let error = $state<string | null>(null);

	/** Taxonomy findings over what is already loaded: no query of their own. */
	const findings = $derived(schema ? runGates(schema, { concepts, stages: ['taxonomy'] }) : []);

	async function loadClasses() {
		schema = await schemaStore.ensureLoaded('schema');
		classTree = buildClassTree(schema, classNamespace);
	}

	async function loadConcepts() {
		if (!core) return;
		const [loadedSchemes, loaded] = await Promise.all([sparqlConnector.fetchConceptSchemes(core), loadAllConcepts(sparqlConnector)]);
		schemes = loadedSchemes;
		concepts = loaded ?? [];
	}

	async function load() {
		error = null;
		try {
			await namespaceStore.ensureLoaded();
			core = await sparqlConnector.fetchVocabularyNamespace();
			await Promise.all([loadConcepts(), loadClasses()]);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the taxonomy';
		}
	}

	async function move(childIri: string, fromIri: string | null, toIri: string | null) {
		if (!core) return;
		await sparqlConnector.setBroader(core, childIri, { from: fromIri, to: toIri });
		await loadConcepts();
	}

	async function setTop(iri: string, top: boolean) {
		if (!core) return;
		await sparqlConnector.setTopConcept(core, iri, top);
		await loadConcepts();
	}

	onMount(() => {
		if (page.data.user) void load();
	});
</script>

<svelte:head>
	<title>Taxonomy — RDF Schema Editor</title>
</svelte:head>

<div class="taxonomy-page">
	<header>
		<h1>Taxonomy</h1>
		<label>
			Class namespace
			<select
				bind:value={classNamespace}
				onchange={() => loadClasses().catch((e) => (error = e instanceof Error ? e.message : 'Failed to load classes'))}
			>
				{#each namespaceStore.namespaces as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix || ns.baseIri}</option>
				{/each}
			</select>
		</label>
	</header>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if core === undefined}
		<p>Loading…</p>
	{:else if core === null}
		<p>No namespace is marked as the core vocabulary yet. <a href={appUrl('/vocabulary')}>Set it up in Vocabulary</a>.</p>
	{:else}
		<TaxonomyOutline {concepts} {schemes} {classTree} {findings} onMove={move} onTopChange={setTop} />
	{/if}
</div>

<style>
	.taxonomy-page {
		padding: 1rem 1.5rem;
	}

	header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	h1 {
		font-size: 1.3rem;
		margin: 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}
</style>
