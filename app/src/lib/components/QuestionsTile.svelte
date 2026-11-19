<script lang="ts">
	/** The Competency questions tile (spec/ontology-dashboard STORY-472): how many questions there are, how the latest
	 *  runs went and how many are not linked to the model. Without questions it says what to do first. */
	import type { QuestionsTileModel } from '#lib/services/ontology-dashboard-model.js';

	interface Props {
		model: QuestionsTileModel;
	}

	let { model }: Props = $props();
</script>

{#if model.total === 0}
	<p data-testid="questions-none">
		No competency questions yet. Write them before modelling: they define the scope of the ontology.
		<a href={model.href}>Questions</a>
	</p>
{:else}
	<p class="total"><a href={model.href}><strong>{model.total}</strong> {model.total === 1 ? 'question' : 'questions'}</a></p>
	<ul>
		<li data-testid="questions-passing">Passing: <strong>{model.passing}</strong></li>
		<li data-testid="questions-failing">Failing: <strong>{model.failing}</strong></li>
		<li data-testid="questions-notrun">Not run: <strong>{model.notRun}</strong></li>
		<li data-testid="questions-unlinked">Not linked to the model: <strong>{model.unlinked}</strong></li>
	</ul>
{/if}

<style>
	p {
		margin: 0 0 0.4rem;
		font-size: 0.9rem;
	}
	.total {
		font-size: 1.1rem;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 1rem;
		font-size: 0.85rem;
	}
	a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	a:hover {
		color: var(--color-accent-hover);
	}
</style>
