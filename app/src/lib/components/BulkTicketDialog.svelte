<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import { createTickets, dryRunTickets, type BulkItem, type TicketRun, type TicketSelection } from '#lib/services/tickets-client.js';
	import { bulkCounts } from '#lib/services/ticket-ui.js';

	interface Props {
		/** The rows (or the filter) the run covers; the dry-run and the real run get exactly this. */
		selection: TicketSelection;
		onClose: () => void;
		/** Called once the real run has finished, so the page can reload its issues. */
		onDone: () => void;
	}

	let { selection, onClose, onDone }: Props = $props();

	/**
	 * spec/service-now-ticket STORY-403: a bulk creation always starts as a dry-run. The real run is only
	 * offered once the preview has been shown, and only when it would create something.
	 */
	let plan = $state<TicketRun | null>(null);
	let result = $state<TicketRun | null>(null);
	let error = $state<string | null>(null);
	let running = $state(false);

	onMount(() => {
		dryRunTickets((...args) => fetch(...args), selection)
			.then((run) => (plan = run))
			.catch((err) => (error = err instanceof Error ? err.message : 'The preview could not be made'));
	});

	const counts = $derived(plan ? bulkCounts(plan) : null);
	const creatable = $derived(counts ? counts.create + counts.followUp : 0);
	const shown = $derived(result ?? plan);

	async function run() {
		error = null;
		running = true;
		try {
			result = await createTickets((...args) => fetch(...args), selection);
			onDone();
		} catch (err) {
			error = err instanceof Error ? err.message : 'The tickets were not created';
		} finally {
			running = false;
		}
	}

	const ACTION_LABEL: Record<string, string> = { create: 'create', 'follow-up': 'follow-up', skip: 'skip', blocked: 'blocked' };

	function status(item: BulkItem): string {
		if (result) return item.result ?? '';
		return item.result === 'deferred' ? 'deferred' : (ACTION_LABEL[item.action] ?? item.action);
	}

	function detail(item: BulkItem): string {
		return item.error || item.reason || '';
	}
</script>

<Modal isOpen={true} title="Create tickets" {onClose} dismissible={!running} maxWidth="900px">
	{#if !plan && !error}
		<p class="hint">Checking what would be created…</p>
	{/if}

	{#if plan && counts}
		<p class="hint">
			{result ? 'Result of the run.' : 'Preview — nothing has been created yet.'}
			ServiceNow gets at most {plan.cap} tickets per run; the rest is deferred.
		</p>
		{#if !result}
			<p class="counts">
				<span>{counts.create} to create</span>
				<span>{counts.followUp} follow-up</span>
				<span>{counts.skip} skipped</span>
				<span>{counts.blocked} blocked</span>
				<span>{counts.deferred} deferred</span>
			</p>
		{/if}
		<table>
			<thead>
				<tr>
					<th>Identity</th>
					<th>Rule</th>
					<th>{result ? 'Result' : 'Plan'}</th>
					<th>Ticket</th>
					<th>Group</th>
					<th>Detail</th>
				</tr>
			</thead>
			<tbody>
				{#each shown?.items ?? [] as item (item.issueId)}
					<tr>
						<td>{item.individualLabel}</td>
						<td>{item.ruleId}</td>
						<td><span class="chip chip-{status(item)}">{status(item)}</span></td>
						<td>
							{#if item.number}<span>{item.number}</span>{:else if item.headline}<span>{item.headline}</span>{/if}
						</td>
						<td>{#if item.assignmentGroup}<span>{item.assignmentGroup}</span>{/if}</td>
						<td>
							{#if detail(item)}<span class:failed={!!item.error}>{detail(item)}</span>{/if}
							{#if item.unrouted}<span class="note">Fallback routing: {item.unrouted}</span>{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="actions">
		{#if result}
			<button type="button" class="primary" onclick={onClose}>Done</button>
		{:else}
			<button type="button" onclick={onClose} disabled={running}>Cancel</button>
			<button type="button" class="primary" disabled={!plan || creatable === 0 || running} onclick={() => void run()}>
				{running ? 'Creating…' : creatable > 0 ? `Create ${creatable} ticket${creatable === 1 ? '' : 's'}` : 'Create'}
			</button>
		{/if}
	</div>
</Modal>

<style>
	.hint {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.counts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1rem;
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th {
		text-align: left;
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.75rem;
		text-transform: uppercase;
	}

	td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		vertical-align: top;
		overflow-wrap: anywhere;
	}

	.chip {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border: 1px solid var(--issue-wontfix-fg);
		border-radius: 999px;
		background: var(--issue-wontfix-bg);
		color: var(--issue-wontfix-fg);
		font-size: 0.78rem;
	}

	.chip-create,
	.chip-follow-up,
	.chip-created {
		border-color: var(--issue-resolved-fg);
		background: var(--issue-resolved-bg);
		color: var(--issue-resolved-fg);
	}

	.chip-blocked,
	.chip-error {
		border-color: var(--issue-open-fg);
		background: var(--issue-open-bg);
		color: var(--issue-open-fg);
	}

	.chip-deferred {
		border-color: var(--issue-progress-fg);
		background: var(--issue-progress-bg);
		color: var(--issue-progress-fg);
	}

	.failed {
		color: var(--color-error);
	}

	.note {
		display: block;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.error {
		color: var(--color-error);
		font-size: 0.9rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.actions button {
		padding: 0.4rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.actions .primary {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.actions button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
