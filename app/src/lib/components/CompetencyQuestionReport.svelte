<script lang="ts">
	/** Result of the last run of every competency question, with a pass/fail strip of the stored
	 *  history (ontology-pipeline STORY-318). Running is the page's job; this only shows and asks. */
	import type { ReportRow } from '#lib/services/competency-question-report.js';

	interface Props {
		rows: ReportRow[];
		/** IRI of the question being run on its own, if any. */
		runningIri: string | null;
		runningAll: boolean;
		onRun: (iri: string) => void;
		onRunAll: () => void;
		/** Shows the results only: no Run buttons. For the review pages (ontology-pipeline STORY-335). */
		readonly?: boolean;
	}

	let { rows, runningIri, runningAll, onRun, onRunAll, readonly = false }: Props = $props();

	const busy = $derived(runningAll || runningIri !== null);
	const LABEL = { pass: 'Pass', fail: 'Fail', error: 'Error' } as const;

	function when(iso: string): string {
		return iso.slice(0, 16).replace('T', ' ');
	}
</script>

<section class="report" aria-labelledby="cq-results-heading">
	<header>
		<h2 id="cq-results-heading">Results</h2>
		{#if !readonly}
			<button type="button" onclick={onRunAll} disabled={busy || rows.length === 0}>
				{runningAll ? 'Running…' : 'Run all'}
			</button>
		{/if}
	</header>

	{#if rows.length === 0}
		<p class="empty">No competency questions to run.</p>
	{:else}
		<table>
			<thead>
				<tr><th>Question</th><th>Result</th><th>Answer</th><th>Duration</th><th>Last run</th><th>History</th>{#if !readonly}<th></th>{/if}</tr>
			</thead>
			<tbody>
				{#each rows as row (row.question.iri)}
					<tr>
						<td>{row.question.question}</td>
						<td>
							{#if row.latest}
								<span class="badge {row.latest.outcome}">{LABEL[row.latest.outcome]}</span>
								{#if row.regression}<span class="badge regression">Regression</span>{/if}
								{#if row.latest.message}<div class="message">{row.latest.message}</div>{/if}
							{:else}
								<span class="badge none">Not run</span>
							{/if}
						</td>
						<td>{row.latest?.actual ?? ''}</td>
						<td>{row.latest ? `${row.latest.durationMs} ms` : ''}</td>
						<td>{row.latest ? when(row.latest.ranAt) : ''}</td>
						<td>
							<span class="strip">
								{#each row.strip as r (r.ranAt)}
									<span class="cell {r.outcome}" role="img" aria-label="{r.outcome} {when(r.ranAt)}" title="{r.outcome} {when(r.ranAt)}"></span>
								{/each}
							</span>
						</td>
						{#if !readonly}
							<td>
								<button type="button" onclick={() => onRun(row.question.iri)} disabled={busy}>
									{runningIri === row.question.iri ? 'Running…' : 'Run'}
								</button>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.report {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 1.05rem;
	}
	table {
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	.badge {
		display: inline-block;
		padding: 0 0.4rem;
		border-radius: 4px;
		font-size: 0.8rem;
		border: 1px solid currentColor;
	}
	.badge.pass {
		color: var(--color-success, #2e7d32);
	}
	.badge.fail,
	.badge.error {
		color: var(--color-error);
	}
	.badge.regression {
		background: var(--color-error);
		color: var(--color-bg);
		border-color: var(--color-error);
	}
	.badge.none {
		color: var(--color-text-muted, inherit);
	}
	.message {
		color: var(--color-error);
		font-size: 0.8rem;
		max-width: 24rem;
	}
	.strip {
		display: inline-flex;
		gap: 2px;
	}
	.cell {
		width: 0.6rem;
		height: 1rem;
		border-radius: 2px;
		background: var(--color-text-muted, gray);
	}
	.cell.pass {
		background: var(--color-success, #2e7d32);
	}
	.cell.fail,
	.cell.error {
		background: var(--color-error);
	}
	.empty {
		margin: 0;
	}
</style>
