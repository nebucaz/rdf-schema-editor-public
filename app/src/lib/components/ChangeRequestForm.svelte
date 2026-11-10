<script lang="ts">
	/** New change request (ontology-pipeline STORY-332): what is proposed, why, and which competency question
	 *  justifies it. A request without a question is allowed but flagged: it can then only be returned or marked
	 *  as a scope change. */
	import { CHANGE_KINDS, type ChangeKind } from '#lib/services/change-log.js';
	import { validateRequestDraft, type ChangeRequestDraft } from '#lib/services/change-request.js';
	import type { CompetencyQuestion } from '#lib/services/competency-question.js';

	interface Props {
		questions: CompetencyQuestion[];
		/** Prefilled with the signed-in user; editable, since it is recorded and not enforced. */
		requestor: string;
		onSave: (draft: ChangeRequestDraft) => Promise<void>;
		onCancel: () => void;
	}

	let { questions, requestor: initialRequestor, onSave, onCancel }: Props = $props();

	let title = $state('');
	/* svelte-ignore state_referenced_locally */
	let requestor = $state(initialRequestor);
	let proposedTerm = $state('');
	let proposedDefinition = $state('');
	let proposedRelations = $state('');
	let rationale = $state('');
	let questionIri = $state('');
	let changeKind = $state<ChangeKind>('addition');
	let errors = $state<string[]>([]);
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const draft: ChangeRequestDraft = {
			title: title.trim(),
			requestor: requestor.trim(),
			proposedTerm: proposedTerm.trim(),
			proposedDefinition: proposedDefinition.trim(),
			proposedRelations: proposedRelations.trim(),
			rationale: rationale.trim(),
			questionIri,
			changeKind
		};
		errors = validateRequestDraft(draft);
		if (errors.length) return;
		busy = true;
		try {
			await onSave(draft);
		} catch (e) {
			errors = [e instanceof Error ? e.message : 'Something went wrong'];
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<label>Title<input type="text" bind:value={title} /></label>
	<label>Requestor<input type="text" bind:value={requestor} /></label>
	<label>Proposed term<input type="text" bind:value={proposedTerm} /></label>
	<label>Proposed definition<textarea rows="2" bind:value={proposedDefinition}></textarea></label>
	<label>Proposed relations<textarea rows="2" bind:value={proposedRelations} placeholder="e.g. Bank has Account"></textarea></label>
	<label>Rationale<textarea rows="2" bind:value={rationale}></textarea></label>
	<label>
		Kind of change
		<select bind:value={changeKind}>
			{#each CHANGE_KINDS as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
	</label>
	<label>
		Competency question
		<select bind:value={questionIri}>
			<option value="">(none)</option>
			{#each questions as q (q.iri)}
				<option value={q.iri}>{q.question}</option>
			{/each}
		</select>
	</label>
	{#if !questionIri}
		<p class="flag" data-testid="missing-question" role="status">
			No competency question is linked. Without one this request can only be returned or marked as a scope change.
		</p>
	{/if}
	{#each errors as message (message)}
		<p class="error" role="alert">{message}</p>
	{/each}
	<div class="actions">
		<button type="button" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Submit request'}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input,
	select,
	textarea {
		font-size: 0.95rem;
		font-family: inherit;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.45rem 0.6rem;
	}

	.flag {
		margin: 0;
		font-size: 0.85rem;
		border: 1px solid var(--color-error);
		color: var(--color-error);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.error {
		margin: 0;
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
</style>
