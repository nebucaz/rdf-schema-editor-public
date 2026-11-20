<script lang="ts">
	/** Read-only page for one concept, `/review/concept?iri=<iri>` (ontology-pipeline STORY-335). The IRI is only
	 *  compared with the IRIs of the fetched concepts. Only reads. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import ConceptReview from '#lib/components/ConceptReview.svelte';
	import { reviewGlossaryUrl, reviewSchemeUrl } from '#lib/services/review-links.js';
	import { schemeIdForIri } from '#lib/services/scheme-id.js';
	import { schemeDisplayName, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import { sparqlConnector } from '#lib/services/sparql-connector.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';

	let concepts = $state<Concept[]>([]);
	let schemes = $state<ConceptScheme[]>([]);
	let core = $state('');
	let loading = $state(true);
	let error = $state<string | null>(null);

	const wanted = $derived(page.url.searchParams.get('iri') ?? '');
	const concept = $derived(concepts.find((c) => c.iri === wanted) ?? null);
	const schemeName = $derived.by(() => {
		const scheme = schemes.find((s) => s.iri === concept?.schemeIri);
		return scheme ? schemeDisplayName(scheme) : '';
	});

	const schemeHref = $derived(concept?.schemeIri && core ? reviewSchemeUrl(schemeIdForIri(concept.schemeIri, core)) : '');

	onMount(async () => {
		if (!page.data.user) return;
		try {
			const base = await sparqlConnector.fetchVocabularyNamespace();
			if (base) {
				core = base;
				[concepts, schemes] = await Promise.all([loadAllConcepts(sparqlConnector).then((c) => c ?? []), sparqlConnector.fetchConceptSchemes(base)]);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the concept';
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>{concept ? `${concept.prefLabels[0]?.text ?? 'Concept'} (review)` : 'Concept (review)'} — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	{#if error}
		<p class="error" role="alert">{error}</p>
	{:else if loading}
		<p>Loading…</p>
	{:else if concept}
		<p class="back"><a href={reviewGlossaryUrl()}>← All concepts</a></p>
		<ConceptReview {concept} {concepts} {schemeName} {schemeHref} {schemes} schemeUrl={(iri) => reviewSchemeUrl(schemeIdForIri(iri, core))} />
	{:else}
		<p>This concept was not found. It may have been deleted, or the link is incomplete.</p>
	{/if}
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		height: 100%;
		box-sizing: border-box;
	}

	.back {
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
	}

	@media print {
		.back {
			display: none;
		}
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
