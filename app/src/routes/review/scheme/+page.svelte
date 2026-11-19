<script lang="ts">
	/** Printable scheme, `/review/scheme?scheme=<id>` (skos-support STORY-427). The id is only compared with the IRIs
	 *  of the fetched schemes (`scheme-id.ts`). Only reads. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import SchemePrintView from '#lib/components/SchemePrintView.svelte';
	import { reviewConceptUrl } from '#lib/services/review-links.js';
	import { resolveScheme } from '#lib/services/scheme-id.js';
	import type { SkosCollection } from '#lib/services/skos-collection.js';
	import { schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';

	let core = $state('');
	let concepts = $state<Concept[]>([]);
	let schemes = $state<ConceptScheme[]>([]);
	let collections = $state<SkosCollection[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	const scheme = $derived(resolveScheme(schemes, page.url.searchParams.get('scheme') ?? '', core));

	onMount(async () => {
		if (!page.data.user) return;
		try {
			const base = await sparqlConnector.fetchVocabularyNamespace();
			if (base) {
				core = base;
				[concepts, schemes, collections] = await Promise.all([
					loadAllConcepts(sparqlConnector).then((c) => c ?? []),
					sparqlConnector.fetchConceptSchemes(base),
					sparqlConnector.fetchCollections(base)
				]);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the scheme';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>{scheme ? `${scheme.metadata?.title || schemeDisplayName(scheme)} (review)` : 'Scheme (review)'} — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else}
		<SchemePrintView {scheme} {concepts} {collections} onOpenConcept={(iri) => void goto(reviewConceptUrl(iri))} />
		{#if scheme}<button type="button" class="print-button" onclick={() => window.print()}>Print</button>{/if}
	{/if}
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		height: 100%;
		box-sizing: border-box;
	}

	.error {
		color: var(--color-error);
	}

	.print-button {
		margin-top: 1rem;
	}

	@media print {
		.review-page {
			padding: 0;
			overflow: visible;
			height: auto;
		}

		.print-button {
			display: none;
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
