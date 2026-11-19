<script lang="ts">
	/** The Scheme health tile (spec/ontology-dashboard STORY-472): the structural metrics of each concept scheme and
	 *  nothing else. The concepts concerned (orphans, clusters, unknown references) are model problems and live in the
	 *  Model checks list, so no concept is listed here. Computed from the concepts the page already loaded. */
	import type { SchemeHealth } from '#lib/services/scheme-health.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		reports: SchemeHealth[];
		/** Scheme names by IRI; the local name of the IRI is used for a scheme not listed. */
		schemeNames?: Record<string, string>;
	}

	let { reports, schemeNames = {} }: Props = $props();

	const nameOf = (iri: string) => (iri === '' ? 'No scheme' : (schemeNames[iri] ?? iri.split(/[#/]/).pop() ?? iri));
	const num = (n: number) => (Math.round(n * 100) / 100).toString();
</script>

{#if reports.length === 0}
	<p class="empty">No concepts to analyse.</p>
{:else}
	<div class="scroll">
		<table aria-label="Scheme health">
			<thead>
				<tr>
					<th scope="col">Scheme</th>
					<th scope="col">Concepts</th>
					<th scope="col">Orphans</th>
					<th scope="col">Clusters</th>
					<th scope="col">Average depth</th>
					<th scope="col">Average branching</th>
				</tr>
			</thead>
			<tbody>
				{#each reports as r (r.schemeIri)}
					<tr>
						<th scope="row">{nameOf(r.schemeIri)}</th>
						<td data-testid="metric-concepts">{r.conceptCount}</td>
						<td data-testid="metric-orphans">{r.orphans.length}</td>
						<td data-testid="metric-clusters">{r.clusters.length}</td>
						<td data-testid="metric-depth">{num(r.averageDepth)}</td>
						<td data-testid="metric-branching">{num(r.averageBranching)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="hint">Concepts that need attention are listed under <a href={appUrl('/pipeline?tab=checks&stage=taxonomy')}>Model checks</a>.</p>
{/if}

<style>
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	th,
	td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		text-align: left;
	}
	thead th {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	.empty,
	.hint {
		margin: 0.4rem 0 0;
		font-size: 0.85rem;
	}
	a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
