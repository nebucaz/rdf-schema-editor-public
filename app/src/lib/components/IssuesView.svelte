<script lang="ts">
	import { listIssues, ISSUE_STATUSES, type Issue } from '#lib/services/issues-client.js';
	import { buildFindingPath, isFindingId } from '#lib/services/finding-link.js';
	import { ISSUE_TRACKER, SERVICE_NOW, type ServiceNowConfig } from '#lib/config.js';
	import { syncTickets } from '#lib/services/tickets-client.js';
	import { syncBadge, toTicketSelection } from '#lib/services/ticket-ui.js';
	import IssueEditModal from './IssueEditModal.svelte';
	import BulkTicketDialog from './BulkTicketDialog.svelte';
	import { groupByIdentity, PAGE_SIZE, toIssueQuery, type IssueFilterForm } from '#lib/services/issues-view.js';

	interface Props {
		/** The signed-in user's `sub`, what the "Mine" assignee filter selects; `null` hides it. */
		currentUser: string | null;
		/** An issue to highlight (`?issue=<id>`, linked from the validation report). */
		focusIssueId?: string | null;
		/** The ServiceNow integration (`serviceNow` in `/config`); with `enabled` false no ticket control renders. */
		serviceNow?: ServiceNowConfig;
	}

	let { currentUser, focusIssueId = null, serviceNow = SERVICE_NOW }: Props = $props();

	/**
	 * validation-issues-tracker STORY-388: the stored issues, listed straight from `GET /issues` — no
	 * validation run needed, so they are there after a reload. Filters and paging are the server's;
	 * "group by identity" only regroups the page on screen.
	 */
	let form = $state<IssueFilterForm>({ status: '', assignee: '', ruleId: '', individualIri: '' });
	let offset = $state(0);
	let groupBy = $state(false);
	let issues = $state<Issue[]>([]);
	let total = $state(0);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let requestSeq = 0;
	let editing = $state<Issue | null>(null);
	/** Ticket controls (spec/service-now-ticket STORY-403): the rows ticked for a bulk run, and its dialog. */
	let selected = $state<string[]>([]);
	let bulkOpen = $state(false);
	let syncing = $state(false);
	let syncMessage = $state<{ text: string; failed: boolean } | null>(null);
	/** Bumped to read the page again after a bulk run or a sync pass changed issues behind the list. */
	let reloadKey = $state(0);

	/** Replaces one issue of the page, for the optimistic edit and its rollback. */
	function applyIssue(next: Issue) {
		issues = issues.map((i) => (i.id === next.id ? next : i));
	}

	$effect(() => {
		const query = toIssueQuery(form, currentUser, offset);
		void reloadKey;
		const seq = ++requestSeq;
		loading = true;
		listIssues((...args) => fetch(...args), query)
			.then((page) => {
				if (seq !== requestSeq) return;
				issues = page.issues;
				total = page.total;
				error = null;
			})
			.catch((err) => {
				if (seq !== requestSeq) return;
				issues = [];
				total = 0;
				error = err instanceof Error ? err.message : 'The issues could not be read';
			})
			.finally(() => {
				if (seq === requestSeq) loading = false;
			});
	});

	/** Changing a filter starts again at the first page. */
	function filterChanged() {
		offset = 0;
	}

	/** Only rows on the current page count: a tick on another page is not carried over. */
	const selectedIds = $derived(selected.filter((id) => issues.some((i) => i.id === id)));

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
	}

	async function syncNow() {
		syncing = true;
		syncMessage = null;
		try {
			const report = await syncTickets((...args) => fetch(...args));
			const errors = report.errors > 0 ? `, ${report.errors} failed${report.message ? ` (${report.message})` : ''}` : '';
			syncMessage = { text: `Sync finished: ${report.pulled} pulled, ${report.pushed} pushed${errors}.`, failed: report.errors > 0 };
			reloadKey++;
		} catch (err) {
			syncMessage = { text: err instanceof Error ? err.message : 'The sync could not run', failed: true };
		} finally {
			syncing = false;
		}
	}

	const groups = $derived(groupByIdentity(issues));
	const rangeText = $derived(total === 0 ? '0 of 0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`);
</script>

{#snippet issueTable(rows: Issue[])}
	<!-- Fixed layout and shared column widths, so the columns line up across all tables of the grouped view. -->
	<table class="issues">
		<colgroup>
			{#if serviceNow.enabled}<col class="col-select" />{/if}
			<col class="col-identity" />
			<col class="col-message" />
			<col class="col-rule" />
			<col class="col-status" />
			<col class="col-assignee" />
			<col class="col-ticket" />
			<col class="col-actions" />
		</colgroup>
		<thead>
			<tr>
				{#if serviceNow.enabled}<th></th>{/if}
				<th>Identity</th>
				<th>Message</th>
				<th>Rule</th>
				<th>Status</th>
				<th>Assignee</th>
				<th>Ticket</th>
				<th></th>
			</tr>
		</thead>
		<tbody>
			{#each rows as issue (issue.id)}
				<tr class:focused={issue.id === focusIssueId} data-issue-id={issue.id}>
					{#if serviceNow.enabled}
						<td>
							<input
								type="checkbox"
								aria-label={`Select ${issue.individualLabel || issue.individualIri}`}
								checked={selected.includes(issue.id)}
								onchange={() => toggle(issue.id)}
							/>
						</td>
					{/if}
					<td title={issue.individualIri}>{issue.individualLabel || issue.individualIri}</td>
					<td>{issue.message}</td>
					<td title={issue.shapeIri}>{issue.ruleId}</td>
					<td>
						<span class="status-chip status-{issue.status}">{issue.status}</span>
						{#if issue.resolvedBy === 'system'}<span class="auto-note">auto-resolved</span>{/if}
					</td>
					<td>{issue.assigneeName || issue.assignee}</td>
					<td>
						{#if issue.externalUrl}
							<a href={issue.externalUrl} target="_blank" rel="noopener noreferrer">{issue.externalId || issue.externalSystem || 'Ticket'}</a>
						{/if}
						{#if serviceNow.enabled}
							{@const badge = syncBadge(issue)}
							{#if badge}
								<span class="sync-badge sync-{badge.state}" title={badge.title}>{badge.label}</span>
								{#if badge.state === 'error'}
									<button type="button" class="edit-btn" disabled={syncing} onclick={() => void syncNow()}>Retry</button>
								{/if}
							{/if}
							{#if issue.followUpNeeded}<span class="follow-up">follow-up needed</span>{/if}
						{/if}
					</td>
					<td>
						{#if isFindingId(issue.id)}
							<a href={buildFindingPath(issue.id)}>Finding</a>
						{/if}
						<button type="button" class="edit-btn" onclick={() => (editing = issue)}>Edit</button>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<div class="issues-view">
	<div class="filters">
		<label>
			Status
			<select bind:value={form.status} onchange={filterChanged}>
				<option value="">Any</option>
				{#each ISSUE_STATUSES as status (status)}
					<option value={status}>{status}</option>
				{/each}
			</select>
		</label>
		<label>
			Assignee
			<select bind:value={form.assignee} onchange={filterChanged}>
				<option value="">Anyone</option>
				{#if currentUser}<option value="mine">Mine</option>{/if}
			</select>
		</label>
		<label>
			Rule
			<input type="text" bind:value={form.ruleId} oninput={filterChanged} />
		</label>
		<label>
			Identity IRI
			<input type="text" bind:value={form.individualIri} oninput={filterChanged} />
		</label>
		<label class="group-toggle">
			<input type="checkbox" bind:checked={groupBy} />
			Group by identity
		</label>
	</div>

	{#if serviceNow.enabled}
		<div class="ticket-bar">
			<button type="button" onclick={() => (bulkOpen = true)}>Create tickets…</button>
			<button type="button" disabled={syncing} onclick={() => void syncNow()}>{syncing ? 'Syncing…' : 'Sync now'}</button>
			<span class="hint">{selectedIds.length > 0 ? `${selectedIds.length} selected` : 'No rows selected: the current filter applies.'}</span>
			{#if !serviceNow.syncEnabled}<span class="hint">Automatic sync is paused; use Sync now to pull ticket changes.</span>{/if}
		</div>
		{#if syncMessage}<p class={syncMessage.failed ? 'error' : 'hint'} role="status">{syncMessage.text}</p>{/if}
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{:else if !loading && issues.length === 0}
		<p class="hint">No issues match. Run a validation to create issues for its findings.</p>
	{:else if groupBy}
		{#each groups as group (group.key)}
			<section class="identity-block">
				<h3>{group.label} ({group.issues.length})</h3>
				{@render issueTable(group.issues)}
			</section>
		{/each}
	{:else}
		{@render issueTable(issues)}
	{/if}

	<div class="pager">
		<button type="button" disabled={offset === 0 || loading} onclick={() => (offset = Math.max(0, offset - PAGE_SIZE))}>Previous</button>
		<span>{rangeText}</span>
		<button type="button" disabled={offset + PAGE_SIZE >= total || loading} onclick={() => (offset += PAGE_SIZE)}>Next</button>
	</div>
</div>

{#if bulkOpen}
	<BulkTicketDialog
		selection={toTicketSelection(form, currentUser, selectedIds)}
		onClose={() => (bulkOpen = false)}
		onDone={() => {
			selected = [];
			reloadKey++;
		}}
	/>
{/if}

{#if editing}
	<IssueEditModal
		issue={editing}
		{serviceNow}
		trackerEnabled={ISSUE_TRACKER.enabled}
		trackerName={ISSUE_TRACKER.name}
		onClose={() => (editing = null)}
		onApply={applyIssue}
		onSaved={applyIssue}
	/>
{/if}

<style>
	.edit-btn {
		margin-left: 0.4rem;
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.78rem;
		cursor: pointer;
	}

	.issues-view {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem 1rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.filters label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.filters .group-toggle {
		flex-direction: row;
		align-items: center;
	}

	.filters select,
	.filters input[type='text'] {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font: inherit;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.9rem;
	}

	table {
		table-layout: fixed;
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	.col-select {
		width: 4%;
	}

	.col-identity {
		width: 14%;
	}

	.col-message {
		width: 28%;
	}

	.col-rule {
		width: 12%;
	}

	.col-status {
		width: 10%;
	}

	.col-assignee {
		width: 12%;
	}

	.col-ticket {
		width: 10%;
	}

	.col-actions {
		width: 14%;
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
		overflow-wrap: anywhere;
	}

	td a {
		color: var(--color-accent);
	}

	tr.focused td {
		background: var(--color-hover);
	}

	.identity-block {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.25rem 0.75rem 0.5rem;
	}

	.identity-block h3 {
		margin: 0.4rem 0;
		font-size: 0.95rem;
	}

	.pager {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.pager button {
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.pager button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.status-chip {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border: 1px solid var(--issue-open-fg);
		border-radius: 999px;
		background: var(--issue-open-bg);
		color: var(--issue-open-fg);
		font-size: 0.78rem;
	}

	.status-in-progress {
		border-color: var(--issue-progress-fg);
		background: var(--issue-progress-bg);
		color: var(--issue-progress-fg);
	}

	.status-resolved {
		border-color: var(--issue-resolved-fg);
		background: var(--issue-resolved-bg);
		color: var(--issue-resolved-fg);
	}

	.status-wontfix {
		border-color: var(--issue-wontfix-fg);
		background: var(--issue-wontfix-bg);
		color: var(--issue-wontfix-fg);
	}

	.ticket-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
	}

	.ticket-bar button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
	}

	.ticket-bar button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.sync-badge {
		display: inline-block;
		padding: 0.05rem 0.45rem;
		border: 1px solid var(--issue-wontfix-fg);
		border-radius: 999px;
		background: var(--issue-wontfix-bg);
		color: var(--issue-wontfix-fg);
		font-size: 0.75rem;
	}

	.sync-synced {
		border-color: var(--issue-resolved-fg);
		background: var(--issue-resolved-bg);
		color: var(--issue-resolved-fg);
	}

	.sync-pending {
		border-color: var(--issue-progress-fg);
		background: var(--issue-progress-bg);
		color: var(--issue-progress-fg);
	}

	.sync-error {
		border-color: var(--issue-open-fg);
		background: var(--issue-open-bg);
		color: var(--issue-open-fg);
	}

	.follow-up {
		display: inline-block;
		margin-left: 0.3rem;
		padding: 0.05rem 0.45rem;
		border: 1px solid var(--color-warning);
		border-radius: 999px;
		background: var(--color-warning-bg);
		color: var(--color-warning);
		font-size: 0.75rem;
	}

	.auto-note {
		margin-left: 0.3rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}
</style>
