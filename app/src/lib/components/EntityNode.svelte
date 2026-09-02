<script module lang="ts">
	import type { Node } from '@xyflow/svelte';
	import type { XsdDatatype } from '$lib/utils/iri';

	export interface EntityAttributeVM {
		iri: string;
		name: string;
		datatype: XsdDatatype;
		required: boolean;
		repeatable: boolean;
	}

	/** An enumerated class member (STORY-019) — e.g. `core:RelationType`'s `nutzt`. */
	export interface EntityMemberVM {
		iri: string;
		label: string;
	}

	export interface EntityNodeData extends Record<string, unknown> {
		classIri: string;
		name: string;
		description: string;
		/** Custom canvas header color (e.g. to visually distinguish association classes from plain
		 *  entities) — a local display preference, not semantic RDF. `undefined` uses the theme default. */
		color?: string;
		/** The owning namespace's default color (STORY-042), used when there's no per-node `color`
		 *  override. Ranks between `color` and the static association/plain theme default in the
		 *  fallback chain below. `undefined` when the namespace has no default color configured. */
		namespaceColor?: string;
		attributes: EntityAttributeVM[];
		/** Always-available, possibly-empty enumerated members list — no separate "is this an
		 *  enumeration" toggle, matching how attributes/relations already work (Decision 3). Managed
		 *  via a dedicated modal (STORY-023), not rendered inline in this node. */
		members: EntityMemberVM[];
		/** Whether this class carries the `AttributedRelationship` marker (STORY-020) — such classes
		 *  don't render the manage-instances icon and can't have members added (STORY-023). */
		isAssociationClass: boolean;
		/** Whether this class carries the `AuthoritativeEntity` marker (data-catalog Story 003) —
		 *  opts it into DCAT catalog generation; gates the "View catalog" menu entry (Story 014). */
		isAuthoritativeEntity: boolean;
		onEdit: () => void;
		onDelete: () => void;
		onAddAttribute: () => void;
		onEditAttribute: (attribute: EntityAttributeVM) => void;
		onDeleteAttribute: (attribute: EntityAttributeVM) => void;
		onManageInstances: () => void;
		/** STORY-043: opens the Triples panel scoped to this entity's own triples. */
		onViewTriples: () => void;
		/** Data-catalog Story 014: opens the Triples panel with the Catalog tab active. Only ever
		 *  invoked when `isAuthoritativeEntity` is true (the menu entry is hidden otherwise). */
		onViewCatalog: () => void;
		/** Sprint 4 Story 013: opens the read-only Provenance/contributor report. Gated on
		 *  `isAuthoritativeEntity` exactly like `onViewCatalog` — provenance data only exists for
		 *  catalog-eligible classes. */
		onViewProvenance: () => void;
		/** STORY-081: removes just this one Workspace-membership row — the class itself and its
		 *  membership in every other Workspace are untouched, unlike `onDelete`. */
		onRemoveFromWorkspace: () => void;
	}

	export type EntityNodeType = Node<EntityNodeData, 'entity'>;
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import NodeMenu, { type NodeMenuEntry } from './NodeMenu.svelte';
	import { descriptionVisibilityStore } from '$lib/stores/description-visibility-store.svelte';

	let { data, selected }: NodeProps<EntityNodeType> = $props();

	const showDescriptions = $derived(descriptionVisibilityStore.getShowDescriptions());

	const menuEntries: NodeMenuEntry[] = $derived([
		{
			label: 'Manage instances',
			icon: manageInstancesIcon,
			onClick: data.onManageInstances,
			hidden: data.isAssociationClass
		},
		{ label: 'View triples', icon: viewTriplesIcon, onClick: data.onViewTriples },
		{
			label: 'View catalog',
			icon: viewCatalogIcon,
			onClick: data.onViewCatalog,
			hidden: !data.isAuthoritativeEntity
		},
		{
			label: 'Provenance',
			icon: provenanceIcon,
			onClick: data.onViewProvenance,
			hidden: !data.isAuthoritativeEntity
		},
		{ label: 'Edit', icon: editIcon, onClick: data.onEdit },
		{ label: 'Remove from workspace', icon: removeFromWorkspaceIcon, onClick: data.onRemoveFromWorkspace },
		{ label: 'Delete', icon: deleteIcon, onClick: data.onDelete }
	]);
</script>

{#snippet manageInstancesIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
{/snippet}

{#snippet viewTriplesIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>
{/snippet}

{#snippet viewCatalogIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
{/snippet}

{#snippet provenanceIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
{/snippet}

{#snippet editIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
{/snippet}

{#snippet deleteIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
{/snippet}

{#snippet removeFromWorkspaceIcon()}
	<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
{/snippet}

<div
	class="entity-node"
	class:selected
	style={`--node-header-bg: ${data.color ?? data.namespaceColor ?? (data.isAssociationClass ? 'var(--color-accent-association)' : 'var(--color-accent)')}`}
	title={!showDescriptions && data.description ? data.description : undefined}
>
	<!-- A source + target handle stacked at each side lets relations attach anywhere around the
		box (dragged from or dropped on whichever side is closest to the other node), instead of
		being pinned to a single left/right pair. The rendered edge path itself is computed as the
		true geometric intersection with the box in RelationEdge/InheritanceEdge/AttributedLinkEdge
		(see `getFloatingEdgeParams`), so these handles only need to offer a grab point per side. -->
	<Handle type="target" position={Position.Top} id="top-target" />
	<Handle type="source" position={Position.Top} id="top-source" />
	<Handle type="target" position={Position.Right} id="right-target" />
	<Handle type="source" position={Position.Right} id="right-source" />
	<Handle type="target" position={Position.Bottom} id="bottom-target" />
	<Handle type="source" position={Position.Bottom} id="bottom-source" />
	<Handle type="target" position={Position.Left} id="left-target" />
	<Handle type="source" position={Position.Left} id="left-source" />
	<div class="header">
		<span class="name" title={data.classIri}>{data.name}</span>
		<div class="header-actions">
			<NodeMenu entries={menuEntries} />
		</div>
	</div>
	{#if showDescriptions && data.description}
		<p class="description">{data.description}</p>
	{/if}
	<ul class="attributes">
		{#each data.attributes as attribute (attribute.iri)}
			<li>
				<span class="attr-name">{attribute.name}</span>
				<span
					class="attr-type"
					title={`${attribute.required ? 'Required (!)' : 'Optional (?)'}${attribute.repeatable ? ', repeatable ([]) — multiple values allowed' : ', single-valued'}`}
				>
					{attribute.datatype}{attribute.required ? '!' : '?'}{attribute.repeatable ? '[]' : ''}
				</span>
				<span class="attr-actions">
					<button class="icon-button small" onclick={() => data.onEditAttribute(attribute)} aria-label={`Edit ${attribute.name}`} title="Edit">
						<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
					</button>
					<button class="icon-button small" onclick={() => data.onDeleteAttribute(attribute)} aria-label={`Delete ${attribute.name}`} title="Delete">
						<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
					</button>
				</span>
			</li>
		{/each}
	</ul>
	<button class="add-attribute" onclick={data.onAddAttribute}>+ Add attribute</button>
</div>

<style>
	.entity-node {
		min-width: 200px;
		max-width: 260px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		font-size: 12px;
		overflow: hidden;
	}

	.entity-node.selected {
		box-shadow: 0 0 0 2px var(--color-accent);
	}

	/* STORY-065: square, hollow connection handles (default is a small filled circle). This is
		CSS-only — `floating-edge.ts`'s boundary-intersection math never reads handle DOM/CSS, only
		each node's bounding box, so edge anchor points are unaffected. The source and target handle
		stacked on each side (see the template comment above) are left at their default identical
		position — deliberately rendering as one square per side, not two — since a connection can
		still be dragged from or dropped on either one at that spot. */
	:global(.entity-node .svelte-flow__handle) {
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

	/* Hidden until the node is hovered, so the handle outline doesn't clutter every entity on a busy
		canvas. Also shown while a connection is actively being dragged from/to this handle
		(`.connectingfrom`/`.connectingto`, classes @xyflow/svelte already applies) — otherwise the
		origin handle would vanish mid-drag the moment the pointer leaves the node. */
	:global(.entity-node:hover .svelte-flow__handle),
	:global(.entity-node .svelte-flow__handle.connectingfrom),
	:global(.entity-node .svelte-flow__handle.connectingto) {
		opacity: 1;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: var(--node-header-bg, var(--color-accent));
		color: #fff;
		font-weight: 600;
		padding: 6px 8px;
	}

	.name {
		/* Flex items default to `min-width: auto` (min-content), so without an explicit basis and
			`min-width: 0` this never actually shrinks to the space `.header-actions` leaves it — it
			either overflows or, worse, ends up frozen at whatever narrow width the flex algorithm
			happened to resolve when a DOM-serializing tool (SVG export, `html-to-image`) snapshots
			computed style onto a detached clone. `flex: 1 1 auto` lets it claim the actual remaining
			width so `text-overflow: ellipsis` only kicks in once the name genuinely doesn't fit. */
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.header-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		min-height: 20px;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		border: none;
		cursor: pointer;
		opacity: 0.85;
	}

	.icon-button:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.2);
	}

	.attributes .icon-button {
		color: var(--color-text-muted);
	}

	.attributes .icon-button:hover {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.description {
		margin: 0;
		padding: 6px 10px 0;
		color: var(--color-text-muted);
		font-size: 11px;
	}

	.attributes {
		list-style: none;
		margin: 0;
		padding: 4px 0;
	}

	.attributes li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 3px 10px;
		border-top: 1px solid var(--color-border);
	}

	.attributes li:first-child {
		border-top: none;
	}

	.attr-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.attr-type {
		color: var(--color-text-muted);
		font-size: 10px;
	}

	.attr-actions {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}

	.add-attribute {
		width: 100%;
		padding: 5px 10px;
		text-align: left;
		font-size: 11px;
		color: var(--color-accent);
		border-top: 1px solid var(--color-border);
		background: transparent;
	}

	.add-attribute:hover {
		background: var(--color-hover);
	}
</style>
