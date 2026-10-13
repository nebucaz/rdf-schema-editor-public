<script lang="ts">
	/**
	 * STORY-200: add and remove annotations on one fact in place. Rendering only — the table owns
	 * the optimistic update and the `/api/annotations` calls; this panel never supplies an author or
	 * timestamp (the server stamps both). Any signed-in user can delete any annotation: the MVP has
	 * no role model (recorded limitation).
	 */
	import { ANNOTATION_MAX_TEXT_LENGTH, type AnnotationInput, type FetchedAnnotation } from '$lib/services/sparql-connector';
	import { describeAnnotation, type BadgeUser } from '$lib/services/annotation-badges';
	import { annotateDisabledReason, isPendingAnnotation } from '$lib/services/annotation-edits';

	interface Props {
		title: string;
		annotations: FetchedAnnotation[];
		labels: { iri: string; label: string }[];
		user: BadgeUser | null;
		error: string | null;
		busy: boolean;
		onAdd: (input: AnnotationInput) => Promise<boolean>;
		onDelete: (iri: string) => void;
		onClose: () => void;
	}

	let { title, annotations, labels, user, error, busy, onAdd, onDelete, onClose }: Props = $props();

	let mode = $state<'text' | 'label'>('text');
	let text = $state('');
	let labelIri = $state('');

	const disabledReason = $derived(annotateDisabledReason(user));
	const views = $derived(annotations.map((a) => ({ a, v: describeAnnotation(a, user) })));
	const canSubmit = $derived(
		!busy &&
			disabledReason === null &&
			(mode === 'text' ? text.trim() !== '' && text.trim().length <= ANNOTATION_MAX_TEXT_LENGTH : labelIri !== '')
	);

	async function submit(event: Event) {
		event.preventDefault();
		if (!canSubmit) return;
		const ok = await onAdd(
			mode === 'text' ? { type: 'text', text: text.trim() } : { type: 'label', labelIri }
		);
		if (ok) {
			text = '';
			labelIri = '';
		}
	}
</script>

<section class="panel" aria-label="Annotations" data-testid="annotation-panel">
	<header>
		<h3>{title}</h3>
		<button type="button" aria-label="Close annotations" onclick={onClose}>×</button>
	</header>

	{#if views.length === 0}
		<p class="empty">No annotations yet.</p>
	{:else}
		<ul class="list" data-testid="annotation-list">
			{#each views as { a, v } (a.iri)}
				<li class:pending={isPendingAnnotation(a)}>
					<span class="content" class:is-label={v.kind === 'label'}>{v.content}</span>
					<span class="by">{v.author} · {v.date}</span>
					{#if disabledReason === null}
						<button
							type="button"
							class="delete"
							aria-label="Delete annotation"
							disabled={isPendingAnnotation(a)}
							onclick={() => onDelete(a.iri)}>Delete</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if disabledReason}
		<p class="notice" data-testid="annotation-disabled">{disabledReason}</p>
	{:else}
		<form onsubmit={submit} class="add">
			<div class="modes">
				<label><input type="radio" bind:group={mode} value="text" /> Comment</label>
				<label><input type="radio" bind:group={mode} value="label" /> Label</label>
			</div>
			{#if mode === 'text'}
				<textarea
					rows="2"
					bind:value={text}
					maxlength={ANNOTATION_MAX_TEXT_LENGTH}
					placeholder="Add a comment…"
					aria-label="Annotation text"
				></textarea>
			{:else}
				<select bind:value={labelIri} aria-label="Annotation label">
					<option value="" disabled>Choose a label…</option>
					{#each labels as l (l.iri)}<option value={l.iri}>{l.label}</option>{/each}
				</select>
			{/if}
			<button type="submit" disabled={!canSubmit}>{busy ? 'Saving…' : 'Add annotation'}</button>
		</form>
	{/if}

	{#if error}
		<p class="error" role="alert" data-testid="annotation-error">{error}</p>
	{/if}
</section>

<style>
	.panel {
		margin: 0.5rem 0;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		font-size: 0.85rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	h3 {
		margin: 0;
		font-size: 0.9rem;
	}
	.list {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: baseline;
	}
	li.pending {
		opacity: 0.6;
	}
	.content {
		overflow-wrap: anywhere;
	}
	.content.is-label {
		font-weight: 600;
	}
	.by {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.add {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.modes {
		display: flex;
		gap: 1rem;
	}
	.empty,
	.notice {
		margin: 0.5rem 0;
		opacity: 0.8;
	}
	.error {
		margin: 0.5rem 0 0;
		color: var(--color-danger, #b00020);
	}
	@media print {
		.panel {
			display: none;
		}
	}
</style>
