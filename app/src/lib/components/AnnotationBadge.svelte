<script lang="ts">
	/**
	 * STORY-199: a small badge on a result cell that carries annotations. The count (or the label
	 * itself for a lone enumerated label) is always visible; hover or keyboard focus reveals the
	 * annotations with author and date. Rendering only — summaries come from `annotation-badges.ts`.
	 */
	import type { FetchedAnnotation } from '$lib/services/sparql-connector';
	import {
		badgeSummary,
		describeAnnotation,
		type BadgeUser
	} from '$lib/services/annotation-badges';

	interface Props {
		annotations: FetchedAnnotation[];
		user?: BadgeUser | null;
	}

	let { annotations, user = null }: Props = $props();

	const summary = $derived(badgeSummary(annotations));
	const views = $derived(annotations.map((a) => describeAnnotation(a, user)));
</script>

{#if summary}
	<button
		type="button"
		class="badge"
		class:label={annotations.length === 1 && annotations[0].type === 'label'}
		aria-label={`${summary.count} annotation${summary.count === 1 ? '' : 's'}`}
		data-testid="annotation-badge"
	>
		{summary.text}
		<span class="popover" role="tooltip">
			<span class="list">
				{#each views as v (v.iri)}
					<span class="item">
						<span class="content" class:is-label={v.kind === 'label'}>{v.content}</span>
						<span class="by">{v.author} · {v.date}</span>
					</span>
				{/each}
			</span>
		</span>
	</button>
{/if}

<style>
	.badge {
		position: relative;
		display: inline-block;
		margin-left: 0.4rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		font-size: 0.75em;
		line-height: 1.5;
		background: var(--color-accent);
		color: #fff;
		border: none;
		font-family: inherit;
		cursor: default;
		vertical-align: middle;
	}
	.badge.label {
		background: var(--color-accent-association);
	}
	.popover {
		display: none;
		position: absolute;
		z-index: 10;
		top: calc(100% + 4px);
		left: 0;
		min-width: 14rem;
		max-width: 22rem;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
		white-space: normal;
		text-align: left;
		font-size: 0.85rem;
		line-height: 1.35;
	}
	.badge:hover .popover,
	.badge:focus .popover,
	.badge:focus-within .popover {
		display: block;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.content {
		display: block;
		overflow-wrap: anywhere;
	}
	.content.is-label {
		font-weight: 600;
	}
	.by {
		display: block;
		font-size: 0.75rem;
		opacity: 0.7;
	}
	@media print {
		/* Annotations stay visible on paper (STORY-198): the popover becomes inline text. */
		.badge {
			background: none;
			color: inherit;
			border: 1px solid currentColor;
		}
		.popover {
			display: block;
			position: static;
			border: none;
			box-shadow: none;
			padding: 0.1rem 0 0;
			background: none;
			min-width: 0;
			max-width: none;
			color: inherit;
		}
	}
</style>
