<script lang="ts">
	/**
	 * Read-only identity resource page (STORY-119, Variant B), ported from `semantic-crm`'s
	 * `NodeDetailPanel.svelte` with its inline-edit feature dropped entirely (v1 is read-only per
	 * `research.md` §7 row 2) and a header added showing the resource's label + `rdf:type`(s), which
	 * `fetchResourcePage` doesn't return as separate fields (`deriveResourceHeader` pulls them back
	 * out of the flat outgoing-triple list).
	 */
	import {
		sparqlConnector,
		type FetchedAssertion,
		type FetchedClass,
		type FetchedNamespace,
		type NameableEntity,
		type ResourcePage
	} from '$lib/services/sparql-connector';
	import {
		buildPropertyRows,
		deriveResourceHeader,
		displayLabel,
		labelOrPrettify,
		splitOutgoingTriples
	} from '$lib/utils/resource-page-format';
	import { resolveClassColor, type ClassHierarchyIndex } from '$lib/utils/namespace-color';
	import { contrastTextColor } from '$lib/utils/contrast';
	import Modal from '$lib/components/Modal.svelte';
	import IdentityNeighborhoodGraph from '$lib/components/IdentityNeighborhoodGraph.svelte';
	import MemberForm from '$lib/components/MemberForm.svelte';
	import type { CanvasRelationFieldSpec, EntityNodeSpec } from '$lib/services/canvas-model';
	import { resolveEditFormSpec, resolveGoverningClass } from '$lib/utils/identity-schema-index';
	import { editIdentity } from '$lib/utils/identity-mutations';
	import type { AttributeValueSubmission } from '$lib/utils/attribute-values';
	import type { RelationTargetOption, RelationValueSubmission } from '$lib/utils/relation-values';

	const EMPTY_CLASS_HIERARCHY_INDEX: ClassHierarchyIndex = {
		classNamespaceByIri: new Map(),
		parentsByClassIri: new Map()
	};

	export interface IdentityRef {
		iri: string;
		label: string;
	}

	interface Props {
		iri: string;
		breadcrumb?: IdentityRef[];
		onNavigate: (ref: IdentityRef) => void;
		onBreadcrumbSelect?: (ref: IdentityRef) => void;
		onBack?: () => void;
		canGoBack?: boolean;
		/** Fired once this identity's real label is resolved, so a caller tracking a breadcrumb trail
		 *  (which starts with only a placeholder prettified-IRI label, `resolveAndSelectNode`) can
		 *  replace it with the genuine one. */
		onLoaded?: (ref: IdentityRef) => void;
		/** Fired after the "Delete" action successfully removes this identity, so the caller can drop
		 *  it from the results list/breadcrumb and clear the selection — this component only owns the
		 *  delete request itself, not what's shown once the identity it was showing no longer exists. */
		onDeleted?: (iri: string) => void;
		/** Used to render each `rdf:type` badge as `prefix:ClassName` and color it by its owning
		 *  namespace — same disambiguation `IdentitySearchBar`/`IdentityResultsList` apply, since a
		 *  bare type name ("Application") can't distinguish two same-named classes in different
		 *  namespaces. */
		classes?: FetchedClass[];
		namespaces?: FetchedNamespace[];
		/** Namespace-default chip color, walking up `rdfs:subClassOf` when a type's own namespace has
		 *  no color set — same resolution `IdentityNeighborhoodGraph`'s Explore graph nodes use
		 *  (`resolveClassColor`). */
		classHierarchyIndex?: ClassHierarchyIndex;
		namespaceColorByBaseIri?: Map<string, string>;
		/** STORY-124: `identities/+page.svelte`'s STORY-121 schema index, reused to resolve the
		 *  Edit modal's `attributes`/`relationFields`/`labelRequired` for this identity's governing
		 *  class — no second query, same index the "Add identity" flow already builds. */
		entityNodeByClassIri?: Map<string, EntityNodeSpec>;
		/** STORY-124: the Identities view's currently active class facet (`lastFacets.classIri`),
		 *  fed into `resolveGoverningClass` (research.md §6 decision 1) alongside this identity's own
		 *  `rdf:type`s. */
		activeClassFacet?: string | null;
	}

	let {
		iri,
		breadcrumb = [],
		onNavigate,
		onBreadcrumbSelect,
		onBack,
		canGoBack = false,
		onLoaded,
		onDeleted,
		classes = [],
		namespaces = [],
		classHierarchyIndex = EMPTY_CLASS_HIERARCHY_INDEX,
		namespaceColorByBaseIri = new Map(),
		entityNodeByClassIri = new Map(),
		activeClassFacet = null
	}: Props = $props();

	const classByIri = $derived(new Map(classes.map((c) => [c.iri, c])));
	const namespacePrefixByBaseIri = $derived(new Map(namespaces.map((ns) => [ns.baseIri, ns.prefix])));

	function typeBadgeLabel(typeIri: string): string {
		const cls = classByIri.get(typeIri);
		const label = labelOrPrettify(cls?.label, typeIri);
		const prefix = cls && namespacePrefixByBaseIri.get(cls.namespaceBaseIri);
		return prefix ? `${prefix}:${label}` : label;
	}

	function typeBadgeColor(typeIri: string): string | undefined {
		return resolveClassColor(typeIri, classHierarchyIndex, namespaceColorByBaseIri);
	}

	let page = $state<ResourcePage | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let isExploring = $state(false);
	let queryCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let queryCopyResetHandle: ReturnType<typeof setTimeout> | undefined;
	let isDeleteConfirmOpen = $state(false);
	let isDeleting = $state(false);
	let deleteError = $state<string | null>(null);

	interface RelationPendingDelete {
		direction: 'out' | 'in';
		subjectIri: string;
		predicateIri: string;
		objectIri: string;
		predicateLabel: string;
		connectedLabel: string;
	}
	let relationPendingDelete = $state<RelationPendingDelete | null>(null);
	let isDeletingRelation = $state(false);
	let relationDeleteError = $state<string | null>(null);

	function openRelationDeleteConfirm(rel: RelationPendingDelete) {
		relationDeleteError = null;
		relationPendingDelete = rel;
	}

	/** Deletes exactly the one `<subject> <predicate> <object>` triple behind a relation row
	 *  (`deleteAssertion`, direction-agnostic — works the same for an outgoing row, where this
	 *  identity is the subject, and an incoming one, where it's the object) after the confirmation
	 *  dialog's explicit "Delete" click. Updates `page` in place on success rather than refetching, so
	 *  the row disappears immediately without an extra round-trip; leaves `page` untouched on failure
	 *  so `relationDeleteError` can be shown and the user can retry/cancel. */
	async function handleConfirmDeleteRelation() {
		const rel = relationPendingDelete;
		if (!rel) return;
		isDeletingRelation = true;
		relationDeleteError = null;
		try {
			await sparqlConnector.deleteAssertion(rel.subjectIri, rel.predicateIri, rel.objectIri);
			if (page) {
				page =
					rel.direction === 'out'
						? {
								...page,
								outgoing: page.outgoing.filter(
									(t) => !(t.predicateIri === rel.predicateIri && t.object === rel.objectIri)
								)
							}
						: {
								...page,
								incoming: page.incoming.filter(
									(t) => !(t.subjectIri === rel.subjectIri && t.predicateIri === rel.predicateIri)
								)
							};
			}
			relationPendingDelete = null;
		} catch (err) {
			relationDeleteError = err instanceof Error ? err.message : 'Failed to delete relation';
		} finally {
			isDeletingRelation = false;
		}
	}

	/** Deletes this identity entirely (`deleteIdentity` — both directions, not just its own outgoing
	 *  triples) after the confirmation dialog's explicit "Delete" click. Left open with `deleteError`
	 *  shown on failure so the user can retry/cancel; on success, hands off to the caller via
	 *  `onDeleted` rather than clearing any local state itself, since there's nothing left here to
	 *  show once the identity is gone. */
	async function handleConfirmDelete() {
		isDeleting = true;
		deleteError = null;
		try {
			await sparqlConnector.deleteIdentity(iri);
			isDeleteConfirmOpen = false;
			onDeleted?.(iri);
		} catch (err) {
			deleteError = err instanceof Error ? err.message : 'Failed to delete identity';
		} finally {
			isDeleting = false;
		}
	}

	/** Copies `buildResourcePageQuery`'s literal SPARQL (the two queries that produced everything on
	 *  this page) to the clipboard, with brief inline feedback rather than a toast — mirrors the
	 *  Explore button's low-ceremony placement right next to the identity's own header. */
	async function handleCopyQuery() {
		clearTimeout(queryCopyResetHandle);
		try {
			await navigator.clipboard.writeText(sparqlConnector.buildResourcePageQuery(iri));
			queryCopyState = 'copied';
		} catch {
			queryCopyState = 'failed';
		}
		queryCopyResetHandle = setTimeout(() => {
			queryCopyState = 'idle';
		}, 2000);
	}

	/** STORY-120: closes the ephemeral neighborhood graph and hands off navigation to the caller —
	 *  every reopen of "Explore" (even for the same identity) starts from a fresh graph instance,
	 *  since `{#if isExploring}` below unmounts `IdentityNeighborhoodGraph` entirely on close. */
	function handleExploreNavigate(ref: IdentityRef) {
		isExploring = false;
		onNavigate(ref);
	}

	$effect(() => {
		const targetIri = iri;
		let cancelled = false;
		isLoading = true;
		error = null;
		page = null;

		sparqlConnector
			.fetchResourcePage(targetIri)
			.then((result) => {
				if (cancelled) return;
				page = result;
				isLoading = false;
				const resolved = deriveResourceHeader(targetIri, result.outgoing);
				onLoaded?.({ iri: targetIri, label: resolved.label });
			})
			.catch((err) => {
				if (cancelled) return;
				error = err instanceof Error ? err.message : 'Failed to load identity';
				isLoading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	const header = $derived(page ? deriveResourceHeader(iri, page.outgoing) : null);
	const split = $derived(page ? splitOutgoingTriples(page.outgoing) : null);
	const propertyRows = $derived(split ? buildPropertyRows(split.literalTriples) : []);

	// -- STORY-124: Edit identity ------------------------------------------------------------------
	// Mirrors `identities/+page.svelte`'s "Add identity" (STORY-123) load-gate/relation-target-option
	// pattern, plus the canvas's own standalone "Edit Individual" modal's assertions wiring
	// (`routes/+page.svelte`'s `editIndividual*`/`ensureAssertionOptionsLoaded`) — adapted to this
	// component's own `iri`/`page` state instead of a canvas node.
	let editOpen = $state(false);
	let editReady = $state(false);
	let editGoverningClassIri = $state<string | null>(null);
	let editAttributeValues = $state<Record<string, string | string[]>>({});
	let editAssertions = $state<FetchedAssertion[]>([]);
	let editRelationTargetOptions = $state<Record<string, RelationTargetOption[]>>({});

	/** Edge case (STORY-124 AC): an identity with zero declared `rdf:type`s resolves a `null`
	 *  governing class — `resolveEditFormSpec` then yields an empty spec, so the Edit button stays
	 *  visible and always opens the modal (no hidden/disabled state), falling back to generic
	 *  Assertions-only editing rather than a class-driven form. */
	const editFormSpec = $derived(resolveEditFormSpec(entityNodeByClassIri, editGoverningClassIri));

	/** Predicate/object typeahead options for the Assertions section, shared across every open of
	 *  this modal (loaded lazily once) — mirrors `routes/+page.svelte`'s `ensureAssertionOptionsLoaded`. */
	let assertionPredicateOptions = $state<{ iri: string; label: string }[]>([]);
	let assertionObjectOptions = $state<NameableEntity[]>([]);
	let assertionOptionsLoaded = false;

	async function ensureAssertionOptionsLoaded() {
		if (assertionOptionsLoaded) return;
		assertionOptionsLoaded = true;
		const [predicateOptions, objectOptions] = await Promise.all([
			sparqlConnector.fetchRelationPredicateOptions(),
			sparqlConnector.fetchNameableEntities()
		]);
		assertionPredicateOptions = predicateOptions;
		assertionObjectOptions = objectOptions;
	}

	/** Mirrors `routes/+page.svelte`'s own `loadRelationTargetOptions` — scoped to this component
	 *  instead of the canvas, with the same namespace-prefix-disambiguated label shape. */
	async function loadRelationTargetOptions(
		relationFields: CanvasRelationFieldSpec[]
	): Promise<Record<string, RelationTargetOption[]>> {
		const entries = await Promise.all(
			relationFields.map(async (rel) => {
				const options = await sparqlConnector.fetchIndividualsOfClass(rel.targetClassIri);
				return [
					rel.iri,
					options.map((o) => ({
						iri: o.iri,
						label: `[${namespacePrefixByBaseIri.get(o.namespaceBaseIri) ?? o.namespaceBaseIri}] ${o.label}`
					}))
				] as const;
			})
		);
		return Object.fromEntries(entries);
	}

	async function reloadEditAssertions() {
		editAssertions = await sparqlConnector.fetchAssertionsForIndividual(iri);
	}

	async function openEditModal() {
		if (!header) return;
		editGoverningClassIri = resolveGoverningClass(header.typeIris, activeClassFacet);
		editReady = false;
		editOpen = true;
		const spec = resolveEditFormSpec(entityNodeByClassIri, editGoverningClassIri);
		await Promise.all([
			ensureAssertionOptionsLoaded(),
			reloadEditAssertions(),
			(async () => {
				editAttributeValues =
					spec.attributes.length > 0
						? await sparqlConnector.fetchIndividualAttributeValues(iri, spec.attributes)
						: {};
			})(),
			(async () => {
				editRelationTargetOptions =
					spec.relationFields.length > 0 ? await loadRelationTargetOptions(spec.relationFields) : {};
			})()
		]);
		editReady = true;
	}

	function closeEditModal() {
		editOpen = false;
		editGoverningClassIri = null;
		editReady = false;
	}

	/** Refetches the whole resource page after a successful edit (research.md §4 item 6) rather than
	 *  hand-patching `page` in place — the edit write surface (label + attributes + relations, all in
	 *  one submit) is broad enough that a full reload is simpler and less bug-prone than extending the
	 *  existing single-field patch logic the relation-delete confirm uses. Also re-fires `onLoaded` so
	 *  a caller tracking a breadcrumb trail picks up a changed label. */
	async function refetchAfterEdit() {
		const result = await sparqlConnector.fetchResourcePage(iri);
		page = result;
		const resolved = deriveResourceHeader(iri, result.outgoing);
		onLoaded?.({ iri, label: resolved.label });
	}

	async function handleEditSubmit(
		label: string,
		_namespaceBaseIri?: string,
		attributeSubmissions: AttributeValueSubmission[] = [],
		_identifier?: string,
		relationSubmissions: RelationValueSubmission[] = []
	) {
		if (!header) return;
		await editIdentity(iri, label, header.label, attributeSubmissions, relationSubmissions);
		closeEditModal();
		await refetchAfterEdit();
	}
</script>

{#snippet trashIcon()}
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<polyline points="3 6 5 6 21 6" />
		<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
		<path d="M10 11v6" />
		<path d="M14 11v6" />
		<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
	</svg>
{/snippet}

<section class="identity-resource-page">
	<header class="detail-header">
		{#if onBack || (onBreadcrumbSelect && breadcrumb.length > 1)}
			<div class="detail-nav">
				{#if onBack}
					<button
						type="button"
						class="back-btn"
						onclick={onBack}
						disabled={!canGoBack}
						aria-label="Back to previous identity"
					>
						← Back
					</button>
				{/if}
				{#if breadcrumb.length > 1}
					<nav class="breadcrumb" aria-label="Recently visited identities">
						{#each breadcrumb as crumb, i (crumb.iri)}
							{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}
							{#if i === breadcrumb.length - 1}
								<span class="crumb current" aria-current="location">{crumb.label}</span>
							{:else}
								<button type="button" class="crumb-link" onclick={() => onBreadcrumbSelect?.(crumb)}>
									{crumb.label}
								</button>
							{/if}
						{/each}
					</nav>
				{/if}
			</div>
		{/if}

		{#if isLoading}
			<h2>Loading…</h2>
		{:else if header}
			<div class="title-row">
				<h2>{header.label}</h2>
				<div class="title-actions">
					<button type="button" class="copy-query-btn" onclick={() => void handleCopyQuery()}>
						{queryCopyState === 'copied'
							? 'Copied!'
							: queryCopyState === 'failed'
								? 'Copy failed'
								: 'Copy query'}
					</button>
					<button type="button" class="explore-btn" onclick={() => (isExploring = true)}>
						Explore
					</button>
					<button type="button" class="edit-btn" onclick={() => void openEditModal()}>
						Edit
					</button>
					<button
						type="button"
						class="delete-btn"
						onclick={() => {
							deleteError = null;
							isDeleteConfirmOpen = true;
						}}
					>
						Delete
					</button>
				</div>
			</div>
			{#if header.typeIris.length > 0}
				<p class="types">
					{#each header.typeIris as typeIri (typeIri)}
						{@const color = typeBadgeColor(typeIri)}
						<span
							class="type-badge"
							style={color
								? `background: ${color}; border-color: ${color}; color: ${contrastTextColor(color)};`
								: undefined}
						>
							{typeBadgeLabel(typeIri)}
						</span>
					{/each}
				</p>
			{/if}
		{/if}
		<code>{iri}</code>
	</header>

	{#if isLoading}
		<p class="muted">Loading…</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if page && header && split}
		{#if split.literalTriples.length === 0 && split.uriTriples.length === 0 && page.incoming.length === 0}
			<p class="muted empty-identity">This identity has no other properties or connections.</p>
		{:else}
			<section class="card">
				<h3>Properties</h3>
				{#if split.literalTriples.length === 0}
					<p class="muted">No properties.</p>
				{:else}
					<ul class="property-list">
						{#each propertyRows as row (row.predicateIri + '|' + row.values.join('|'))}
							<li class="property-row">
								<span class="property-label" title={row.predicateIri}>{displayLabel(row.predicateLabel)}</span>
								<span class="property-value">
									{#if row.displayAsChips}
										<span class="chip-list">
											{#each row.values as value (value)}
												<span class="chip">{value}</span>
											{/each}
										</span>
									{:else}
										{row.values.join(', ')}
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="card">
				<h3>Outgoing</h3>
				{#if split.uriTriples.length === 0}
					<p class="muted">No outgoing connections.</p>
				{:else}
					<ul class="connection-list">
						{#each split.uriTriples as t (t.predicateIri + t.object)}
							<li class="connection-row">
								<span class="predicate-cell" title={t.predicateIri}>
									<span class="direction" aria-hidden="true">→</span>
									<span class="visually-hidden">out</span>
									{displayLabel(t.predicateLabel)}
								</span>
								<span class="value-cell">
									<button
										type="button"
										class="link-btn"
										onclick={() => onNavigate({ iri: t.object, label: labelOrPrettify(t.objectLabel, t.object) })}
									>
										<span class="connected-label">{labelOrPrettify(t.objectLabel, t.object)}</span>
									</button>
									<button
										type="button"
										class="trash-btn"
										aria-label="Delete relation"
										title="Delete relation"
										onclick={() =>
											openRelationDeleteConfirm({
												direction: 'out',
												subjectIri: iri,
												predicateIri: t.predicateIri,
												objectIri: t.object,
												predicateLabel: t.predicateLabel,
												connectedLabel: labelOrPrettify(t.objectLabel, t.object)
											})}
									>
										{@render trashIcon()}
									</button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="card">
				<h3>Incoming (what links here)</h3>
				{#if page.incoming.length === 0}
					<p class="muted">Nothing links here.</p>
				{:else}
					<ul class="connection-list">
						{#each page.incoming as t (t.subjectIri + t.predicateIri)}
							<li class="connection-row">
								<span class="predicate-cell" title={t.predicateIri}>
									<span class="direction" aria-hidden="true">←</span>
									<span class="visually-hidden">in</span>
									{displayLabel(t.predicateLabel)}
								</span>
								<span class="value-cell">
									<button
										type="button"
										class="link-btn"
										onclick={() => onNavigate({ iri: t.subjectIri, label: t.subjectLabel })}
									>
										<span class="connected-label">{displayLabel(t.subjectLabel)}</span>
									</button>
									<button
										type="button"
										class="trash-btn"
										aria-label="Delete relation"
										title="Delete relation"
										onclick={() =>
											openRelationDeleteConfirm({
												direction: 'in',
												subjectIri: t.subjectIri,
												predicateIri: t.predicateIri,
												objectIri: iri,
												predicateLabel: t.predicateLabel,
												connectedLabel: displayLabel(t.subjectLabel)
											})}
									>
										{@render trashIcon()}
									</button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	{/if}
</section>

{#if isExploring}
	<Modal isOpen={true} title="Explore neighborhood" onClose={() => (isExploring = false)} maxWidth="90vw">
		<div class="explore-canvas">
			<IdentityNeighborhoodGraph seedIri={iri} onNavigate={handleExploreNavigate} />
		</div>
	</Modal>
{/if}

{#if editOpen}
	<Modal isOpen={true} title="Edit identity" onClose={closeEditModal} dismissible={false}>
		{#if editReady}
			<MemberForm
				mode="edit"
				initialLabel={header?.label ?? ''}
				submitLabel="Save"
				onCancel={closeEditModal}
				onSubmit={handleEditSubmit}
				individualIri={iri}
				assertions={editAssertions}
				predicateOptions={assertionPredicateOptions}
				objectOptions={assertionObjectOptions}
				attributes={editFormSpec.attributes}
				attributeValues={editAttributeValues}
				labelRequired={editFormSpec.labelRequired}
				relationFields={editFormSpec.relationFields}
				relationTargetOptions={editRelationTargetOptions}
				onAddAssertion={async (predicateLabel, objectIri) => {
					await sparqlConnector.insertAssertion(iri, predicateLabel, objectIri);
					await reloadEditAssertions();
				}}
				onDeleteAssertion={async (predicateIri, objectIri) => {
					await sparqlConnector.deleteAssertion(iri, predicateIri, objectIri);
					await reloadEditAssertions();
				}}
			/>
		{:else}
			<p class="muted">Loading…</p>
		{/if}
	</Modal>
{/if}

{#if isDeleteConfirmOpen}
	<Modal
		isOpen={true}
		title="Delete identity"
		onClose={() => {
			if (!isDeleting) isDeleteConfirmOpen = false;
		}}
	>
		<div class="delete-confirm">
			<p>
				Delete <strong>{header?.label ?? iri}</strong>? This removes every triple shown on this
				page — its properties, outgoing links, and every incoming link from other identities — and
				cannot be undone.
			</p>
			{#if deleteError}
				<p class="delete-error">{deleteError}</p>
			{/if}
			<div class="delete-confirm-actions">
				<button
					type="button"
					class="secondary-btn"
					onclick={() => (isDeleteConfirmOpen = false)}
					disabled={isDeleting}
				>
					Cancel
				</button>
				<button type="button" class="danger-btn" onclick={() => void handleConfirmDelete()} disabled={isDeleting}>
					{isDeleting ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</div>
	</Modal>
{/if}

{#if relationPendingDelete}
	<Modal
		isOpen={true}
		title="Delete relation"
		onClose={() => {
			if (!isDeletingRelation) relationPendingDelete = null;
		}}
	>
		<div class="delete-confirm">
			<p>
				Delete the relation <strong>{displayLabel(relationPendingDelete.predicateLabel)}</strong> →
				<strong>{relationPendingDelete.connectedLabel}</strong>? This removes just this triple and
				cannot be undone.
			</p>
			{#if relationDeleteError}
				<p class="delete-error">{relationDeleteError}</p>
			{/if}
			<div class="delete-confirm-actions">
				<button
					type="button"
					class="secondary-btn"
					onclick={() => (relationPendingDelete = null)}
					disabled={isDeletingRelation}
				>
					Cancel
				</button>
				<button
					type="button"
					class="danger-btn"
					onclick={() => void handleConfirmDeleteRelation()}
					disabled={isDeletingRelation}
				>
					{isDeletingRelation ? 'Deleting…' : 'Delete'}
				</button>
			</div>
		</div>
	</Modal>
{/if}

<style>
	.identity-resource-page {
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 1rem;
		height: 100%;
		overflow: auto;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.detail-nav {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.back-btn {
		flex-shrink: 0;
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.back-btn:hover:not(:disabled) {
		border-color: var(--color-accent);
	}

	.back-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.crumb-link {
		border: 0;
		background: transparent;
		color: var(--color-accent);
		cursor: pointer;
		font: inherit;
		padding: 0;
	}

	.crumb-link:hover {
		text-decoration: underline;
	}

	.crumb.current {
		color: var(--color-text);
		font-weight: 600;
	}

	.crumb-sep {
		color: var(--color-text-muted);
	}

	.detail-header h2 {
		margin: 0 0 0.25rem;
	}

	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.title-actions {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.4rem;
	}

	.copy-query-btn {
		flex-shrink: 0;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.copy-query-btn:hover {
		border-color: var(--color-accent);
		color: var(--color-text);
	}

	.explore-btn {
		flex-shrink: 0;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.explore-btn:hover {
		background: var(--color-accent);
		color: var(--color-bg-secondary);
	}

	.explore-canvas {
		height: 70vh;
	}

	.edit-btn {
		flex-shrink: 0;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.edit-btn:hover {
		background: var(--color-accent);
		color: var(--color-bg-secondary);
	}

	.delete-btn {
		flex-shrink: 0;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--color-error);
		border-radius: 6px;
		background: transparent;
		color: var(--color-error);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.delete-btn:hover {
		background: var(--color-error);
		color: #fff;
	}

	.delete-confirm p {
		margin: 0 0 0.75rem;
		color: var(--color-text);
	}

	.delete-error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.delete-confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	.secondary-btn,
	.danger-btn {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.secondary-btn {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary-btn:hover:not(:disabled) {
		background: var(--color-hover);
	}

	.danger-btn {
		border: 1px solid var(--color-error);
		background: var(--color-error);
		color: #fff;
	}

	.secondary-btn:disabled,
	.danger-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.types {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0.5rem 0 0.4rem;
	}

	.type-badge {
		display: inline-block;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 0.78rem;
	}

	.detail-header code {
		font-size: 0.75rem;
		word-break: break-all;
		color: var(--color-text-muted);
	}

	.card {
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem;
	}

	.card h3 {
		margin: 0 0 0.5rem;
	}

	.property-list,
	.connection-list {
		display: grid;
		grid-template-columns: minmax(140px, max-content) 1fr;
		column-gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.property-row,
	.connection-row {
		display: contents;
	}

	.property-label,
	.property-value,
	.predicate-cell,
	.value-cell {
		display: flex;
		align-items: center;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--color-border);
		text-align: left;
	}

	.property-row:last-child > .property-label,
	.property-row:last-child > .property-value,
	.connection-row:last-child > .predicate-cell,
	.connection-row:last-child > .value-cell {
		border-bottom: none;
	}

	.property-label,
	.predicate-cell {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.property-value {
		color: var(--color-text);
	}

	.chip-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem 0.6rem;
		border-radius: 999px;
		background: var(--color-bg-alt);
		border: 1px solid var(--color-border);
		font-size: 0.85rem;
		color: var(--color-text);
	}

	.value-cell {
		justify-content: space-between;
		gap: 0.5rem;
		min-width: 0;
	}

	.link-btn {
		display: inline-flex;
		align-items: center;
		min-width: 0;
		text-align: left;
		color: var(--color-accent);
		cursor: pointer;
		border: 0;
		background: transparent;
		font: inherit;
		padding: 0;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	.trash-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.3rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.trash-btn:hover {
		color: var(--color-error);
		border-color: var(--color-error);
	}

	.direction {
		color: var(--color-text-muted);
		flex-shrink: 0;
		margin-right: 0.35rem;
	}

	.connected-label {
		color: var(--color-accent);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.muted {
		color: var(--color-text-muted);
	}

	.empty-identity {
		padding: 1rem 0;
	}

	.error {
		color: var(--color-error);
	}
</style>
