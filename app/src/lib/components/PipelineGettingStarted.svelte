<script lang="ts">
	/** A short, linked checklist for people new to the pipeline: what to do first and where. */
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		/** Whether any namespace is marked as part of the pipeline; the first step is open until one is. */
		hasPipelineNamespace: boolean;
	}

	let { hasPipelineNamespace }: Props = $props();
</script>

<div class="getting-started" data-testid="getting-started">
	<p class="order">
		Recommended order: vocabulary, taxonomy, thesaurus, ontology, validation, application. It is a guide, not a
		rule. Work on any stage at any time, return to earlier ones, and skip what you do not need. Nothing here
		blocks anything.
	</p>
	<details class="steps" open={!hasPipelineNamespace} data-testid="getting-started-steps">
	<summary>New to the ontology pipeline? Start here</summary>
	<ol>
		<li>
			<strong>Pick the namespaces.</strong>
			Open Settings, Manage, Namespaces, edit a namespace and tick <em>Part of the ontology pipeline</em>. Only those appear below.
		</li>
		<li>
			<strong>Write the competency questions.</strong>
			List what the model must answer in <a href={appUrl('/questions')}>Questions</a>. Do this before the first modelling decision: they define the scope of the ontology.
		</li>
		<li>
			<strong>Agree the terms.</strong>
			Define them in <a href={appUrl('/vocabulary')}>Vocabulary</a>, then arrange them in <a href={appUrl('/taxonomy')}>Taxonomy</a>.
		</li>
		<li>
			<strong>Model it.</strong>
			Draw classes and relations on the <a href={appUrl('/')}>Schema</a> canvas and link each class to its term.
		</li>
		<li>
			<strong>Check and release.</strong>
			Run the questions again, work through the Model checks, and record changes and releases in
			<a href={appUrl('/governance')}>Governance</a>.
		</li>
	</ol>
</details>
</div>

<style>
	.getting-started {
		max-width: 60rem;
		font-size: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	ol {
		margin: 0.5rem 0;
		padding-left: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	p {
		margin: 0;
	}
</style>
