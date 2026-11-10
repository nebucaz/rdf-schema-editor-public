<script lang="ts">
	/** The change requests (ontology-pipeline STORY-332): review, impact assessment and outcome. Which outcomes
	 *  are offered follows `allowedOutcomes`; the page does the writes. */
	import {
		STATUS_LABELS,
		allowedOutcomes,
		canDecide,
		canStartReview,
		validateOutcome,
		type ChangeRequest,
		type RequestOutcome
	} from '#lib/services/change-request.js';
	import type { CompetencyQuestion } from '#lib/services/competency-question.js';

	interface Props {
		requests: ChangeRequest[];
		questions: CompetencyQuestion[];
		onStartReview: (iri: string) => Promise<void>;
		onAssess: (iri: string) => Promise<void>;
		onDecide: (iri: string, outcome: RequestOutcome, rationale: string) => Promise<void>;
	}

	let { requests, questions, onStartReview, onAssess, onDecide }: Props = $props();

	const OUTCOME_LABEL: Record<RequestOutcome, string> = {
		approved: 'Approve',
		rejected: 'Reject',
		returned: 'Return',
		'scope-change': 'Scope change'
	};

	let rationales = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let busy = $state<string | null>(null);

	const questionText = (iri: string) => questions.find((q) => q.iri === iri)?.question ?? iri;
	const outcomeText = (o: string | null) => o ?? 'not run';

	async function run(iri: string, action: () => Promise<void>) {
		busy = iri;
		errors[iri] = '';
		try {
			await action();
		} catch (e) {
			errors[iri] = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = null;
		}
	}

	async function decide(r: ChangeRequest, outcome: RequestOutcome) {
		const rationale = rationales[r.iri] ?? '';
		const problem = validateOutcome(r, outcome, rationale);
		if (problem) {
			errors[r.iri] = problem;
			return;
		}
		await run(r.iri, async () => {
			await onDecide(r.iri, outcome, rationale.trim());
			rationales[r.iri] = '';
		});
	}
</script>

{#if requests.length === 0}
	<p class="empty">No change requests.</p>
{:else}
	<ul class="requests">
		{#each requests as r (r.iri)}
			<li>
				<header>
					<strong>{r.title}</strong>
					<span class="status status-{r.status}">{STATUS_LABELS[r.status]}</span>
				</header>
				<p class="meta">By {r.requestor} · {r.changeKind}{r.createdAt ? ` · ${r.createdAt}` : ''}</p>
				<dl>
					{#if r.proposedTerm}<dt>Term</dt><dd>{r.proposedTerm}</dd>{/if}
					{#if r.proposedDefinition}<dt>Definition</dt><dd>{r.proposedDefinition}</dd>{/if}
					{#if r.proposedRelations}<dt>Relations</dt><dd>{r.proposedRelations}</dd>{/if}
					<dt>Rationale</dt><dd>{r.rationale}</dd>
					<dt>Competency question</dt>
					<dd>
						{#if r.questionIri}
							{questionText(r.questionIri)}
						{:else}
							<span class="flag">No competency question linked</span>
						{/if}
					</dd>
				</dl>

				{#if r.impact}
					<div class="impact" data-testid="impact">
						<h4>Impact</h4>
						{#if r.impact.questions.length === 0 && r.impact.newFindings.length === 0 && r.impact.resolvedFindings.length === 0}
							<p>No change in the competency question results or the gate findings.</p>
						{/if}
						{#if r.impact.questions.length}
							<ul>
								{#each r.impact.questions as c (c.questionIri)}
									<li>{questionText(c.questionIri)}: {outcomeText(c.before)} → {outcomeText(c.after)}</li>
								{/each}
							</ul>
						{/if}
						{#if r.impact.newFindings.length}
							<p>New gate findings</p>
							<ul>{#each r.impact.newFindings as f (f.gateId + f.elementIri + f.message)}<li>{f.message}</li>{/each}</ul>
						{/if}
						{#if r.impact.resolvedFindings.length}
							<p>Resolved gate findings</p>
							<ul>{#each r.impact.resolvedFindings as f (f.gateId + f.elementIri + f.message)}<li>{f.message}</li>{/each}</ul>
						{/if}
					</div>
				{/if}

				{#if canDecide(r)}
					<div class="actions">
						{#if canStartReview(r)}
							<button type="button" disabled={busy === r.iri} onclick={() => run(r.iri, () => onStartReview(r.iri))}>Start review</button>
						{/if}
						<button type="button" disabled={busy === r.iri} onclick={() => run(r.iri, () => onAssess(r.iri))}>Assess impact</button>
					</div>
					<label>
						Rationale for the outcome
						<textarea rows="2" bind:value={rationales[r.iri]}></textarea>
					</label>
					<div class="actions">
						{#each allowedOutcomes(r) as outcome (outcome)}
							<button type="button" disabled={busy === r.iri} onclick={() => decide(r, outcome)}>{OUTCOME_LABEL[outcome]}</button>
						{/each}
					</div>
				{:else if r.outcomeRationale}
					<p class="decided">
						{STATUS_LABELS[r.status]}{r.decidedBy ? ` by ${r.decidedBy}` : ''}{r.decidedAt ? ` on ${r.decidedAt}` : ''}: {r.outcomeRationale}
					</p>
				{/if}
				{#if errors[r.iri]}
					<p class="error" role="alert">{errors[r.iri]}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.requests {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	li {
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	header {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.status {
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 0.5rem;
		color: var(--color-text-muted);
	}

	.meta,
	.empty {
		margin: 0;
		font-size: 0.82rem;
		color: var(--color-text-muted);
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.2rem 0.75rem;
		margin: 0;
		font-size: 0.9rem;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
	}

	.flag,
	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.error {
		margin: 0;
	}

	.impact {
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.7rem;
		font-size: 0.85rem;
	}

	.impact h4,
	.impact p {
		margin: 0.2rem 0;
	}

	.impact ul {
		margin: 0.2rem 0 0.4rem 1rem;
		padding: 0;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	textarea {
		font-size: 0.9rem;
		font-family: inherit;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	button {
		padding: 0.4rem 0.85rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.decided {
		margin: 0;
		font-size: 0.88rem;
	}
</style>
