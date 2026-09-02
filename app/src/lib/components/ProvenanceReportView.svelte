<script lang="ts">
	import { onMount } from 'svelte';
	import { sparqlConnector, type ProvenanceReport } from '$lib/services/sparql-connector';

	/**
	 * Story 013: read-only per-attribute provenance/contributor report, driven entirely by Story
	 * 012's `fetchProvenanceReport`. No save/edit affordance anywhere in this component — changing an
	 * `isMasterFor` assertion happens through the existing STORY-004/STORY-019 editors, not here.
	 */
	interface Props {
		classIri: string;
	}

	let { classIri }: Props = $props();

	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let report = $state<ProvenanceReport | null>(null);

	async function load() {
		loading = true;
		loadError = null;
		try {
			report = await sparqlConnector.fetchProvenanceReport(classIri);
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to load provenance report';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	function formatTimestamp(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
	}
</script>

<div class="report">
	{#if loading}
		<p class="hint">Loading…</p>
	{:else if loadError}
		<p class="error">{loadError}</p>
	{:else if report && report.attributes.length === 0}
		<p class="hint">{report.className} has no attributes yet.</p>
	{:else if report}
		<table>
			<thead>
				<tr>
					<th>Attribute</th>
					<th>Contributor</th>
					<th>Authority</th>
					<th>Last generated</th>
				</tr>
			</thead>
			<tbody>
				{#each report.attributes as attr (attr.attributeIri)}
					<tr>
						<td>{attr.attributeLabel}</td>
						<td>
							{#if attr.masterLabel}
								<span class="contributor">{attr.masterLabel}</span>
								<span class="badge" title={attr.isAttributeOverride ? 'Attribute-level override' : 'Class-level default'}>
									{attr.isAttributeOverride ? 'override' : 'default'}
								</span>
							{:else}
								<span class="unknown">no known contributor</span>
							{/if}
						</td>
						<td>
							{#if attr.authorityLabel}
								{attr.authorityLabel}
							{:else}
								<span class="unknown">—</span>
							{/if}
						</td>
						<td>
							{#if attr.generatedAt}
								{formatTimestamp(attr.generatedAt)}
							{:else}
								<span class="unknown">never generated</span>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.report {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 480px;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th {
		text-align: left;
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
	}

	td {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		vertical-align: top;
	}

	tr:last-child td {
		border-bottom: none;
	}

	.contributor {
		font-weight: 500;
	}

	.badge {
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--color-hover);
		color: var(--color-text-muted);
		font-size: 0.7rem;
	}

	.unknown {
		color: var(--color-text-muted);
		font-style: italic;
	}
</style>
