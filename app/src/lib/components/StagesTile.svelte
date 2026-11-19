<script lang="ts">
	/** The Stages tile (spec/ontology-dashboard STORY-471): every namespace of the pipeline against the six stages in one
	 *  table, replacing the strip per namespace. Counts link to the screen that lists what was counted. */
	import { STAGE_IDS, STAGE_LABEL, type NamespaceSummary, type StageId } from '#lib/services/pipeline-summary.js';

	interface Props {
		summaries: NamespaceSummary[];
		/** Stages whose data is still loading: shown as "Loading…" instead of counts or "Not started". */
		pending?: StageId[];
	}

	let { summaries, pending = [] }: Props = $props();

	function findingsText(warnings: number, infos: number): string {
		const parts: string[] = [];
		if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
		if (infos > 0) parts.push(`${infos} info`);
		return parts.join(', ');
	}
</script>

{#if summaries.length === 0}
	<p data-testid="no-pipeline-namespaces">
		No namespace is part of the pipeline yet. Tick <em>Part of the ontology pipeline</em> in a namespace's form to list it here.
	</p>
{:else}
	<div class="scroll">
		<table aria-label="Stages by namespace">
			<thead>
				<tr>
					<th scope="col">Namespace</th>
					{#each STAGE_IDS as id (id)}
						<th scope="col">{STAGE_LABEL[id]}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each summaries as summary (summary.namespaceBaseIri)}
					<tr>
						<th scope="row">{summary.prefix}</th>
						{#each STAGE_IDS as id (id)}
							{@const s = summary.stages.find((x) => x.stage === id)}
							<td class:started={s?.status === 'in-progress'}>
								{#if pending.includes(id)}
									<span class="muted" data-testid="stage-loading">Loading…</span>
								{:else if !s || s.status === 'not-started'}
									<span class="muted">Not started</span>
								{:else}
									{#each s.stats as stat (stat.label)}
										<div>
											{#if stat.href}
												<a href={stat.href}>{stat.label}: <strong>{stat.value}</strong></a>
											{:else}
												{stat.label}: <strong>{stat.value}</strong>
											{/if}
										</div>
									{/each}
									{#if s.warnings + s.infos > 0}
										<div class="findings">{findingsText(s.warnings, s.infos)}</div>
									{/if}
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
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
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
	}
	thead th {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}
	td.started {
		background: var(--color-bg-secondary);
	}
	.muted {
		color: var(--color-text-muted);
	}
	a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	a:hover {
		color: var(--color-accent-hover);
	}
	.findings {
		color: var(--color-error);
		font-size: 0.8rem;
	}
</style>
