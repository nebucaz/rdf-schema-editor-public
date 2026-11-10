<script lang="ts">
	/** Entry to the read-only review pages for domain experts (ontology-pipeline STORY-335). Reading is open to
	 *  everyone who is signed in; editing stays with the other areas. Nothing here writes. */
	import { reviewPipelineUrl, reviewQuestionsUrl } from '#lib/services/review-links.js';
	import { appUrl } from '#lib/utils/urls.js';
</script>

<svelte:head>
	<title>Review — RDF Schema Editor</title>
</svelte:head>

<div class="review-page">
	<h1>Review</h1>
	<p>Read-only pages for reviewing the work without changing it. Share the link of any page.</p>
	<ul>
		<li><a href={reviewQuestionsUrl()}>Competency questions</a> and their latest results</li>
		<li><a href={reviewPipelineUrl()}>Pipeline status</a> of each namespace</li>
		<li>A concept: open it from the <a href={appUrl('/vocabulary')}>Vocabulary</a> area with "Read-only page"</li>
	</ul>
</div>

<style>
	.review-page {
		padding: 1rem 1.5rem;
	}

	h1 {
		font-size: 1.3rem;
	}
</style>
