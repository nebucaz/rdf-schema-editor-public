<script lang="ts">
	import { onMount } from 'svelte';
	import Modal from './Modal.svelte';
	import { fetchAssignees, ISSUE_STATUSES, updateIssue, type Assignee, type Issue, type IssueStatus } from '#lib/services/issues-client.js';
	import { createTicket } from '#lib/services/tickets-client.js';
	import { currentTicket, syncBadge, ticketAction } from '#lib/services/ticket-ui.js';
	import { SERVICE_NOW, type ServiceNowConfig } from '#lib/config.js';

	interface Props {
		issue: Issue;
		/** Whether an external tracker is configured (`issueTracker.enabled`); the ticket fields are hidden otherwise. */
		trackerEnabled: boolean;
		trackerName: string;
		onClose: () => void;
		/** Called with the edited issue before the request (optimistic) and with the original if the save fails. */
		onApply: (issue: Issue) => void;
		onSaved: (issue: Issue) => void;
		/** The ServiceNow integration (`serviceNow` in `/config`); with `enabled` false no ticket control renders. */
		serviceNow?: ServiceNowConfig;
	}

	let { issue, trackerEnabled, trackerName, onClose, onApply, onSaved, serviceNow = SERVICE_NOW }: Props = $props();

	/** Same limit as the backend (`issues.MaxNote`). */
	const MAX_NOTE = 4000;

	/**
	 * validation-issues-tracker STORY-389: edit one issue's status, assignee, note and ticket reference.
	 * The assignee pick list shows `displayName` and stores the `sub`; the ticket link is the server's
	 * `externalUrl`, never built here. Used by the Issues page and the report row alike.
	 */
	let status = $state<IssueStatus>(issue.status);
	let assignee = $state(issue.assignee);
	let note = $state(issue.note);
	let externalSystem = $state(issue.externalSystem || trackerName);
	let externalId = $state(issue.externalId);
	let assignees = $state<Assignee[]>([]);
	let saving = $state(false);
	let creating = $state(false);
	let error = $state<string | null>(null);
	/** The issue as the modal last knew it: `issue` until a ticket is created here, then the backend's answer. */
	let live = $state<Issue>(issue);

	onMount(() => {
		fetchAssignees((...args) => fetch(...args))
			.then((list) => (assignees = list))
			.catch((err) => (error = err instanceof Error ? err.message : 'The assignees could not be read'));
	});

	/** The current assignee is always an option, even before (or without) the list. */
	const options = $derived.by(() => {
		const list = [...assignees];
		if (issue.assignee && !list.some((a) => a.sub === issue.assignee)) {
			list.unshift({ sub: issue.assignee, displayName: issue.assigneeName || issue.assignee });
		}
		return list;
	});

	const ticket = $derived(currentTicket(live));
	const action = $derived(ticketAction(live));
	const badge = $derived(syncBadge(live));
	/** A ticket that is not closed (a closed one makes the next action a follow-up). */
	const openTicket = $derived(ticket !== null && action.kind === 'create');
	/** ServiceNow owns the assignee while its ticket is open (spec/service-now-ticket Q17). */
	const assigneeLocked = $derived(serviceNow.enabled && openTicket);
	/** The manual ticket fields mirror the ServiceNow ticket once there is one, so they are not offered then. */
	const showManualTicket = $derived(trackerEnabled && !(serviceNow.enabled && live.tickets.length > 0));
	const history = $derived(live.tickets.slice(0, -1).reverse());

	const noAutoReopen = $derived(status === 'resolved' || status === 'wontfix');

	/** Opens the (follow-up) ticket; the modal stays open to show its number and link, or the backend's refusal. */
	async function create() {
		error = null;
		creating = true;
		try {
			const created = await createTicket((...args) => fetch(...args), live.id);
			live = created;
			onSaved(created);
		} catch (err) {
			error = err instanceof Error ? err.message : 'The ticket was not created';
		} finally {
			creating = false;
		}
	}

	async function save() {
		if (note.length > MAX_NOTE) {
			error = `The note can have at most ${MAX_NOTE} characters.`;
			return;
		}
		error = null;
		saving = true;
		const picked = options.find((a) => a.sub === assignee);
		onApply({
			...live,
			status,
			assignee,
			assigneeName: assignee ? (picked?.displayName ?? live.assigneeName) : '',
			note,
			externalSystem: showManualTicket ? externalSystem : live.externalSystem,
			externalId: showManualTicket ? externalId : live.externalId
		});
		try {
			const saved = await updateIssue((...args) => fetch(...args), issue.id, {
				status,
				...(assigneeLocked ? {} : { assignee }),
				note,
				...(showManualTicket ? { externalSystem: externalSystem.trim(), externalId: externalId.trim() } : {})
			});
			onSaved(saved);
			onClose();
		} catch (err) {
			onApply(live);
			error = err instanceof Error ? err.message : 'The issue was not saved';
		} finally {
			saving = false;
		}
	}
</script>

<Modal isOpen={true} title="Edit issue" {onClose} dismissible={!saving}>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<p class="summary"><strong>{issue.individualLabel || issue.individualIri}</strong> — {issue.message}</p>

		<label>
			Status
			<select bind:value={status}>
				{#each ISSUE_STATUSES as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</label>
		{#if noAutoReopen}
			<p class="hint">An issue set to {status} will not be re-opened automatically when the finding returns.</p>
		{/if}

		<label>
			Assignee
			<select bind:value={assignee} disabled={assigneeLocked}>
				<option value="">Unassigned</option>
				{#each options as option (option.sub)}
					<option value={option.sub}>{option.displayName}</option>
				{/each}
			</select>
		</label>

		{#if assigneeLocked}
			<p class="hint">While the ticket is open, ServiceNow is the master for the assignee.</p>
		{/if}

		<label>
			Note
			<textarea rows="4" bind:value={note}></textarea>
		</label>

		{#if serviceNow.enabled}
			<section class="ticket-section" aria-label="Ticket">
				<h3>Ticket</h3>
				{#if ticket}
					<p class="ticket">
						<a href={ticket.url || live.externalUrl} target="_blank" rel="noopener noreferrer">{ticket.number}</a>
						<span>{ticket.stateLabel || ticket.state}</span>
						{#if badge}<span class="sync-badge sync-{badge.state}" title={badge.title}>{badge.label}</span>{/if}
					</p>
					{#if live.serviceNowGroup}<p class="meta"><span>Group: {live.serviceNowGroup}</span></p>{/if}
					{#if live.serviceNowAssignee}<p class="meta"><span>ServiceNow assignee: {live.serviceNowAssignee}</span></p>{/if}
					{#if live.syncState === 'error' && live.lastError}<p class="error">{live.lastError}</p>{/if}
				{:else}
					<p class="hint">No ticket yet.</p>
				{/if}
				{#if history.length > 0}
					<ul class="history" aria-label="Ticket history">
						{#each history as old (old.correlationId)}
							<li><a href={old.url} target="_blank" rel="noopener noreferrer">{old.number}</a> <span>{old.stateLabel || old.state}</span></li>
						{/each}
					</ul>
				{/if}
				{#if !openTicket}
					<div>
						<button type="button" disabled={action.disabledReason !== null || creating || saving} onclick={() => void create()}>
							{creating ? 'Creating…' : action.label}
						</button>
					</div>
					{#if action.disabledReason}<p class="hint">{action.disabledReason}</p>{/if}
				{/if}
			</section>
		{/if}

		{#if showManualTicket}
			<label>
				Ticket system
				<input type="text" bind:value={externalSystem} />
			</label>
			<label>
				Ticket id
				<input type="text" bind:value={externalId} />
			</label>
			{#if issue.externalUrl}
				<p class="ticket">
					<a href={issue.externalUrl} target="_blank" rel="noopener noreferrer">{issue.externalUrl}</a>
				</p>
			{/if}
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="actions">
			<button type="button" onclick={onClose} disabled={saving}>Cancel</button>
			<button type="submit" class="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
		</div>
	</form>
</Modal>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	select,
	input,
	textarea {
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: var(--color-bg);
		color: var(--color-text);
		font: inherit;
	}

	.summary {
		margin: 0;
		font-size: 0.9rem;
		color: var(--color-text);
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.ticket {
		margin: 0;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.ticket a {
		color: var(--color-accent);
	}

	.ticket-section {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}

	.ticket-section h3 {
		margin: 0;
		font-size: 0.9rem;
	}

	.ticket-section .ticket {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.meta {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.history {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	.ticket-section button {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
	}

	.ticket-section button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.sync-badge {
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

	.error {
		margin: 0;
		color: var(--color-error);
		font-size: 0.9rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
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
