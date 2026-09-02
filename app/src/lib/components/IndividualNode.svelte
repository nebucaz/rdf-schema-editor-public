<script module lang="ts">
	import type { Node } from '@xyflow/svelte';

	export interface IndividualNodeData extends Record<string, unknown> {
		label: string;
		classIri: string;
		className: string;
		/** data-catalog Story 019: opens this individual for editing (rename + generic assertion
		 *  CRUD) via the pencil button below. Disabled (see `syncSource`) rather than removed for a
		 *  synced individual — Story 010. */
		onEdit: () => void;
		/** Opens the Triples panel scoped to this individual's own IRI — the only way to see an
		 *  individual's own assertions in isolation (`selectScope`'s subject-only fallback branch
		 *  already supports this; entity nodes have had the equivalent button since STORY-043). */
		onViewTriples: () => void;
		/** The `rse:syncSource` marker value (e.g. `"backstage"`), or `null` for an ordinary
		 *  hand-authored individual (report Story 007/010, `canvas-model.ts`'s `IndividualNodeSpec`).
		 *  Non-null renders a badge and disables the pencil edit button — a synced individual is
		 *  machine-owned and overwritten on the next sync regardless of any manual edit, so editing
		 *  is disabled rather than silently reverted later. */
		syncSource: string | null;
		/** `true` when this synced individual disappeared from its upstream source's latest run
		 *  (Story 009/010) — renders a visually distinct badge state from a normal synced individual. */
		isStale: boolean;
	}

	export type IndividualNodeType = Node<IndividualNodeData, 'individual'>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps<IndividualNodeType> = $props();
</script>

<div class="individual-node" class:selected>
	<!-- Source+target pair per side, mirroring EntityNode: an individual can both *initiate* a
		relation (e.g. isMasterFor, Story 006) and *receive* one — the target handle lets another
		individual's connection land here for individual→individual relations (relation-assertions
		Sprint 3 Story 005). Self-connection (an individual dragged onto itself) is rejected in
		`+page.svelte`'s `handleConnect`, not at the handle level, since Svelte Flow's `Handle` has no
		per-node "reject same id" primitive. -->
	<Handle type="target" position={Position.Top} id="top-target" />
	<Handle type="source" position={Position.Top} id="top-source" />
	<Handle type="target" position={Position.Right} id="right-target" />
	<Handle type="source" position={Position.Right} id="right-source" />
	<Handle type="target" position={Position.Bottom} id="bottom-target" />
	<Handle type="source" position={Position.Bottom} id="bottom-source" />
	<Handle type="target" position={Position.Left} id="left-target" />
	<Handle type="source" position={Position.Left} id="left-source" />
	<button
		type="button"
		class="edit-button"
		onclick={data.syncSource ? undefined : data.onEdit}
		disabled={!!data.syncSource}
		aria-label={data.syncSource ? `${data.label} is synced and cannot be edited` : `Edit ${data.label}`}
		title={data.syncSource
			? `Synced from ${data.syncSource} — edits are overwritten on the next sync`
			: 'Edit'}
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
	</button>
	<button
		type="button"
		class="view-triples-button"
		onclick={data.onViewTriples}
		aria-label={`View triples for ${data.label}`}
		title="View triples"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>
	</button>
	{#if data.syncSource}
		<span
			class="sync-badge"
			class:stale={data.isStale}
			title={data.isStale
				? `No longer seen in the latest ${data.syncSource} sync`
				: `Synced from ${data.syncSource}`}
		>
			{data.isStale ? '⚠' : '⇄'}
			{data.syncSource}
		</span>
	{/if}
	<span class="label" title={data.classIri}>{data.label}</span>
	<span class="class-name">{data.className}</span>
</div>

<style>
	.individual-node {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 120px;
		max-width: 200px;
		padding: 6px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-bg-secondary);
		font-size: 11px;
	}

	/* Hover-revealed, matching EntityNode's own convention for its header icons. */
	.edit-button,
	.view-triples-button {
		position: absolute;
		top: -8px;
		right: -8px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		min-height: 18px;
		border-radius: 50%;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		opacity: 0;
		transition: opacity 0.1s ease;
	}

	.view-triples-button {
		right: 14px;
	}

	.individual-node:hover .edit-button,
	.individual-node:hover .view-triples-button {
		opacity: 1;
	}

	.edit-button:hover,
	.view-triples-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.edit-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.edit-button:disabled:hover {
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
	}

	.individual-node.selected {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	/* Story 010: badge distinguishing a machine-synced individual from a hand-authored one, with a
	   distinct visual state (amber) once it's gone stale (Story 009) — readable in both themes via
	   theme-token colors rather than fixed hex values. */
	.sync-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		align-self: flex-start;
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		background: var(--color-hover);
		color: var(--color-accent);
		border: 1px solid var(--color-accent);
	}

	/* No dedicated "warning" theme token exists yet (only error/success) — reusing --color-error
	   here since "no longer seen upstream" is exactly the kind of thing an error color should draw
	   the eye to, and it's already defined for both light/dark themes. */
	.sync-badge.stale {
		background: var(--color-error-bg);
		color: var(--color-error);
		border-color: var(--color-error);
	}

	/* See EntityNode.svelte's identical rule for why handles are hidden until hover/drag. */
	:global(.individual-node .svelte-flow__handle) {
		width: 9px;
		height: 9px;
		min-width: 9px;
		min-height: 9px;
		background: transparent;
		border: 1px solid var(--color-text-muted, #888);
		border-radius: 2px;
		opacity: 0;
		transition: opacity 0.1s ease;
	}

	:global(.individual-node:hover .svelte-flow__handle),
	:global(.individual-node .svelte-flow__handle.connectingfrom) {
		opacity: 1;
	}

	.label {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.class-name {
		color: var(--color-text-muted);
		font-size: 10px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
