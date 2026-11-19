<script lang="ts">
	/** Read-only glossary, `/review/glossary` (skos-support STORY-425): search, tree and A-Z of the vocabulary with a
	 *  detail panel. Signed-in readers only (the layout shows the sign-in screen otherwise). Only reads. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import GlossaryBrowser from '#lib/components/GlossaryBrowser.svelte';
	import type { SkosCollection } from '#lib/services/skos-collection.js';
	import type { Concept } from '#lib/services/skos-concept.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	let concepts = $state<Concept[]>([]);
	let collections = $state<SkosCollection[]>([]);
	let classes = $state<{ iri: string; label: string; definedByConcept?: string }[]>([]);
	let hasVocabulary = $state(true);
	let loading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		if (!page.data.user) return;
		try {
			const core = await sparqlConnector.fetchVocabularyNamespace();
			if (!core) {
				hasVocabulary = false;
				return;
			}
			const [all, cols, schema] = await Promise.all([
				loadAllConcepts(sparqlConnector).then((c) => c ?? []),
				sparqlConnector.fetchCollections(core),
				schemaStore.ensureLoaded('schema')
			]);
			concepts = all;
			collections = cols;
			classes = schema.classes.filter((k) => k.definedByConcept);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the glossary';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Glossary (review) — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	<h1>Glossary</h1>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else if !hasVocabulary}
		<p>No vocabulary has been set up yet.</p>
	{:else}
		<GlossaryBrowser {concepts} {collections} {classes} />
	{/if}
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		height: 100%;
		box-sizing: border-box;
	}

	h1 {
		font-size: 1.3rem;
	}

	.error {
		color: var(--color-error);
	}

	@media print {
		.review-page {
			padding: 0;
			overflow: visible;
			height: auto;
		}

		:global(body:has(.review-page) .app-header) {
			display: none;
		}

		:global(body:has(.review-page) .app-main) {
			overflow: visible;
			height: auto;
		}
	}
</style>
