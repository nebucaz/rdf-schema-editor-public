<script lang="ts">
	/** The change log: who, when, what and why, filtered by term, competency question and version
	 *  (ontology-pipeline STORY-331). The filters are sent to the server; the view only holds their inputs. */
	import type { ChangeLogFilter, ChangeLogItem } from '#lib/services/change-log.js';

	interface Props {
		entries: ChangeLogItem[];
		onFilter: (filter: ChangeLogFilter) => Promise<void>;
	}

	let { entries, onFilter }: Props = $props();

	let term = $state('');
	let question = $state('');
	let version = $state('');
	let busy = $state(false);

	async function apply(event: SubmitEvent) {
		event.preventDefault();
		const filter: ChangeLogFilter = {};
		if (term.trim()) filter.term = term.trim();
		if (question.trim()) filter.question = question.trim();
		if (version.trim()) filter.version = version.trim();
		busy = true;
		try {
			await onFilter(filter);
		} finally {
			busy = false;
		}
	}

	const shortName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;
</script>

<form class="filters" onsubmit={apply}>
	<label>Term (IRI)<input type="text" bind:value={term} /></label>
	<label>Question (IRI)<input type="text" bind:value={question} /></label>
	<label>Version<input type="text" bind:value={version} /></label>
	<button type="submit" disabled={busy}>Filter</button>
</form>

{#if entries.length === 0}
	<p class="empty">No entries.</p>
{:else}
	<table>
		<thead>
			<tr><th>When</th><th>Who</th><th>What</th><th>Why</th><th>Term</th><th>Question</th><th>Version</th></tr>
		</thead>
		<tbody>
			{#each entries as e (e.iri)}
				<tr class:release={e.kind === 'release'}>
					<td>{e.changedAt.slice(0, 16).replace('T', ' ')}</td>
					<td>{e.changedBy}</td>
					<td>
						{e.summary}
						{#if e.changeKind}<span class="kind">{e.changeKind}</span>{/if}
					</td>
					<td>{e.rationale}</td>
					<td title={e.term}>{e.term ? shortName(e.term) : ''}</td>
					<td title={e.question}>{e.question ? shortName(e.question) : ''}</td>
					<td>{e.version}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.6rem;
		margin-bottom: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	button {
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}

	th {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.release {
		font-weight: 600;
	}

	.kind {
		margin-left: 0.4rem;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 0.4rem;
	}

	.empty {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}
</style>
