<script lang="ts">
	/** Review list for creating concepts from existing classes (ontology-pipeline STORY-326). Each unlinked
	 *  class shows the concept proposed for it; label and definition can be edited, then a row is accepted on
	 *  its own or all at once. Accepted rows leave the list; a refusal keeps them and says why. */
	import Modal from './Modal.svelte';
	import type { BackfillProposal, BackfillRow } from '#lib/services/concept-backfill.js';

	interface Props {
		isOpen: boolean;
		proposals: BackfillProposal[];
		/** Titles of existing concepts by IRI, to name the target of a "link" proposal. */
		conceptTitles: Map<string, string>;
		/** Writes the rows; rejects with a message when a row is unacceptable. */
		onAccept: (rows: BackfillRow[]) => Promise<void>;
		onClose: () => void;
	}

	let { isOpen, proposals, conceptTitles, onAccept, onClose }: Props = $props();

	interface Draft {
		proposal: BackfillProposal;
		label: string;
		definition: string;
	}

	// Seeded from the proposals each time the modal gets a new list; the user edits copies.
	let drafts = $state<Draft[]>([]);
	let error = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		drafts = proposals.map((proposal) => ({ proposal, label: proposal.label, definition: proposal.definition }));
		error = null;
	});

	const toRow = (d: Draft): BackfillRow => ({
		classIri: d.proposal.classIri,
		namespaceBaseIri: d.proposal.namespaceBaseIri,
		label: d.label,
		definition: d.definition
	});

	async function accept(chosen: Draft[]) {
		busy = true;
		error = null;
		try {
			await onAccept(chosen.map(toRow));
			const done = new Set(chosen.map((d) => d.proposal.classIri));
			drafts = drafts.filter((d) => !done.has(d.proposal.classIri));
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<Modal {isOpen} title="Create concepts for unlinked classes" {onClose} maxWidth="860px" dismissible={false}>
	{#if drafts.length === 0}
		<p class="empty">Every class already has a concept.</p>
	{:else}
		<p class="intro">
			Each class below has no defining concept. Review the concept proposed for it, edit the label or definition
			if needed, and accept. New concepts start as <em>proposed</em>; the class is linked to its concept.
		</p>
		<table>
			<thead><tr><th>Class</th><th>What happens</th><th>Label</th><th>Definition</th><th></th></tr></thead>
			<tbody>
				{#each drafts as d (d.proposal.classIri)}
					<tr>
						<td class="class-label">{d.proposal.label}</td>
						<td>
							{#if d.proposal.action === 'link'}
								Link to {conceptTitles.get(d.proposal.conceptIri) ?? d.proposal.conceptIri}
							{:else}
								Create concept
							{/if}
						</td>
						<td><input type="text" aria-label="Label for {d.proposal.label}" bind:value={d.label} /></td>
						<td><textarea rows="2" aria-label="Definition for {d.proposal.label}" bind:value={d.definition}></textarea></td>
						<td><button type="button" disabled={busy} onclick={() => accept([d])}>Accept</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<div class="actions">
		{#if drafts.length > 0}
			<button type="button" class="primary" disabled={busy} onclick={() => accept(drafts)}>Accept all</button>
		{/if}
	</div>
</Modal>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.88rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}

	input,
	textarea {
		width: 100%;
		box-sizing: border-box;
		font-size: 0.88rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.3rem 0.45rem;
	}

	.intro,
	.empty {
		margin-top: 0;
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.75rem;
	}

	button {
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		font-size: 0.88rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
