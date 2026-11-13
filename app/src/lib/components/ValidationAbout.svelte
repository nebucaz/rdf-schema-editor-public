<script lang="ts">
	/** Short, collapsible explanation at the top of the Validation page, one text per tab. */
	interface Props {
		tab: 'shacl' | 'gates';
	}
	let { tab }: Props = $props();
</script>

<details class="about no-print">
	<summary>{tab === 'shacl' ? 'What does SHACL validation check?' : 'What is the Gate report?'}</summary>
	{#if tab === 'shacl'}
		<p>
			Checks the data (the individuals) against the SHACL shapes in your repository, for example required
			properties, datatypes, lengths, patterns and custom <code>sh:sparql</code> rules. Each finding names the
			identity, the rule and the offending value. Constraints the report cannot check are listed in a banner.
			The check runs on the backend when you click <strong>Run Validation</strong>.
		</p>
	{:else}
		<p>
			Checks the model itself, not the data: the quality gates of the ontology pipeline (vocabulary, taxonomy,
			thesaurus, ontology and governance). Findings are grouped by pipeline stage, some offer a fix, and
			<strong>Open</strong> takes you to the screen where you can resolve them. The report is advisory: a finding never
			blocks a save.
		</p>
	{/if}
</details>

<style>
	.about {
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.about summary {
		cursor: pointer;
		color: var(--color-text-muted);
	}

	.about p {
		margin: 0.5rem 0 0;
		max-width: 60rem;
		color: var(--color-text-muted);
	}
</style>
