<script lang="ts">
	/** Short, collapsible explanation at the top of the Validation page. */
	import { appUrl } from '#lib/utils/urls.js';
</script>

<details class="about no-print">
	<summary>What does SHACL validation check?</summary>
	<p>
		Checks the data (the individuals) against the SHACL shapes in your repository, for example required
		properties, datatypes, lengths, patterns and custom <code>sh:sparql</code> rules. Each finding names the
		identity, the rule and the offending value. Constraints the report cannot check are listed in a banner.
		The check runs on the backend when you click <strong>Run Validation</strong>.
	</p>
	<p>
		Whether the model itself is well built is a separate question, answered by
		<a href={appUrl('/pipeline?tab=checks')}>Model checks</a> on the Ontology page.
	</p>
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
