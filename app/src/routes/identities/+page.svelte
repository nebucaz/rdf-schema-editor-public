<script lang="ts">
	/**
	 * STORY-118/119: the Identities area — search/filter/list individuals (Variant A) and, once one
	 * is selected, a read-only resource page for it (Variant B) — entirely off the schema canvas, no
	 * `viewMode`/`Workspace` involvement (`spec/browse-identity/plan.md`'s ADR table). Both halves are
	 * URL-addressable via `identity-search-url.ts`'s `?q=`/`class=`/`ns=`/`source=`/`status=`/`node=`
	 * params, mirroring `semantic-crm`'s `+page.svelte` `?q=`/`?p=`/`?node=` pattern (list search
	 * replaces the current history entry, right-column identity navigation pushes new entries — same
	 * split as the ported original).
	 */
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import IdentitySearchBar, { type IdentityFacetValues } from '$lib/components/IdentitySearchBar.svelte';
	import IdentityResultsList from '$lib/components/IdentityResultsList.svelte';
	import IdentityResourcePage, { type IdentityRef } from '$lib/components/IdentityResourcePage.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import MemberForm from '$lib/components/MemberForm.svelte';
	import UnclassifiedBulkBar from '$lib/components/UnclassifiedBulkBar.svelte';
	import { BULK_UNDO_LIMIT } from '$lib/services/sparql-connector';
	import {
		sparqlConnector,
		type FetchedClass,
		type FetchedSchema,
		type FetchedSubClassOf,
		type IndividualSearchResult
	} from '$lib/services/sparql-connector';
	import type { CanvasRelationFieldSpec, EntityNodeSpec } from '$lib/services/canvas-model';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { isUnclassifiedQueryTooShort, keysetAfter } from '$lib/utils/unclassified-search';
	import { UNCLASSIFIED_FACET, buildIdentitySearchUrl, parseIdentitySearchParams } from '$lib/utils/identity-search-url';
	import { prettifyLocalName } from '$lib/utils/resource-page-format';
	import { buildClassHierarchyIndex, type ClassHierarchyIndex } from '$lib/utils/namespace-color';
	import { buildEntityNodeIndex } from '$lib/utils/identity-schema-index';
	import { createIdentity, resolveDefaultNamespace } from '$lib/utils/identity-mutations';
	import type { AttributeValueSubmission } from '$lib/utils/attribute-values';
	import type { RelationTargetOption, RelationValueSubmission } from '$lib/utils/relation-values';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '$lib/config';

	const PAGE_SIZE = 50;
	const BREADCRUMB_MAX = 3;
	const EMPTY_FACETS: IdentityFacetValues = {
		query: '',
		classIri: null,
		namespaceBaseIri: null,
		syncSource: null,
		syncStatus: null
	};

	let results = $state<IndividualSearchResult[]>([]);
	let hasMore = $state(false);
	let hasSearched = $state(false);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let lastFacets = $state<IdentityFacetValues>(EMPTY_FACETS);
	let nextOffset = 0;
	/** How many Unclassified individuals match the active filters; `null` outside Unclassified mode. */
	let unclassifiedTotal = $state<number | null>(null);
	let queryTooShort = $state(false);
	let searchSeq = 0;

	// Bulk class assignment (Unclassified mode only). A selection is either explicit rows or "everything
	// matching the current filters"; changing the filters drops it.
	let checkedIris = $state<Set<string>>(new Set());
	let allMatching = $state(false);
	let bulkProgress = $state<{ assigned: number; total: number } | null>(null);
	let bulkAbort: AbortController | null = null;
	let lastBulk = $state<{ iris: string[]; classIri: string; label: string } | null>(null);

	const inUnclassifiedMode = $derived(lastFacets.classIri === UNCLASSIFIED_FACET);
	const pageSelected = $derived(results.length > 0 && results.every((r) => checkedIris.has(r.iri)));
	const selectionCount = $derived(allMatching ? (unclassifiedTotal ?? 0) : checkedIris.size);

	function classOptionText(cls: FetchedClass): string {
		return `${namespacePrefixFor(cls.namespaceBaseIri)}: ${cls.label}`;
	}

	function clearSelection() {
		checkedIris = new Set();
		allMatching = false;
	}

	function toggleChecked(iri: string) {
		const next = new Set(checkedIris);
		if (!next.delete(iri)) next.add(iri);
		checkedIris = next;
		allMatching = false;
	}

	function selectPage() {
		checkedIris = new Set(results.map((r) => r.iri));
		allMatching = false;
	}

	async function applyBulkClass(classIri: string) {
		const explicit = !allMatching;
		const iris = [...checkedIris];
		const filter = explicit
			? { iris }
			: { query: lastFacets.query || undefined, namespaceBaseIri: lastFacets.namespaceBaseIri ?? undefined };
		const className = bulkClassOptions.find((c) => c.iri === classIri)?.label ?? classIri;
		bulkAbort = new AbortController();
		bulkProgress = { assigned: 0, total: selectionCount };
		lastBulk = null;
		error = null;
		try {
			const { assigned } = await sparqlConnector.assignClassToUnclassified(filter, classIri, {
				signal: bulkAbort.signal,
				onProgress: (p) => (bulkProgress = p)
			});
			if (explicit && iris.length <= BULK_UNDO_LIMIT && assigned > 0) {
				lastBulk = { iris, classIri, label: `Gave ${assigned.toLocaleString()} individuals the class ${className}.` };
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to assign the class';
		} finally {
			bulkProgress = null;
			bulkAbort = null;
			clearSelection();
		}
		await runSearch(lastFacets);
	}

	async function undoBulk() {
		if (!lastBulk) return;
		const { iris, classIri } = lastBulk;
		lastBulk = null;
		try {
			await sparqlConnector.unassignClassFromIndividuals(iris, classIri);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to undo';
		}
		await runSearch(lastFacets);
	}

	let selectedIri = $state<string | null>(null);
	let breadcrumb = $state<IdentityRef[]>([]);
	const nodeCache = new Map<string, IdentityRef>();

	const EMPTY_SCHEMA: FetchedSchema = {
		classes: [],
		datatypeProperties: [],
		objectProperties: [],
		subClassOf: [],
		individuals: [],
		individualClassRelations: [],
		individualIndividualRelations: []
	};

	let classes = $state<FetchedClass[]>([]);
	const bulkClassOptions = $derived(
		classes
			.map((c) => ({ iri: c.iri, label: classOptionText(c) }))
			.sort((a, b) => a.label.localeCompare(b.label))
	);
	let subClassOf = $state<FetchedSubClassOf[]>([]);
	/** STORY-121: the full schema (not just `.classes`/`.subClassOf`), kept so `buildCanvasModel` can
	 *  derive each class's own+inherited `attributes`/`relationFields`/`labelRequired` for the
	 *  Add/Edit identity forms (STORY-123/124) without a second query. */
	let fullSchema = $state<FetchedSchema>(EMPTY_SCHEMA);

	/** Namespace-default color resolution (mirrors `IdentityNeighborhoodGraph`'s Explore-graph node
	 *  coloring) for `IdentityResourcePage`'s type-badge chips. */
	const classHierarchyIndex = $derived<ClassHierarchyIndex>(buildClassHierarchyIndex(classes, subClassOf));
	/** STORY-121: `buildCanvasModel(fullSchema)`'s entity nodes, indexed by class IRI — O(1) lookup of
	 *  a class's `{attributes, relationFields, labelRequired}` for the Add/Edit identity forms. */
	const entityNodeByClassIri = $derived<Map<string, EntityNodeSpec>>(buildEntityNodeIndex(fullSchema));
	const namespaceColorByBaseIri = $derived(
		new Map(namespaceStore.namespaces.filter((ns) => ns.color).map((ns) => [ns.baseIri, ns.color as string]))
	);

	// -- STORY-123: "Add identity" from the class filter -----------------------------------------
	// Gated on `lastFacets.classIri` per research.md §5.1 — the button itself stays visible but
	// disabled until a class facet is active, matching the seed request's own framing.
	let addIdentityOpen = $state(false);
	let addIdentityClassIri = $state<string | null>(null);
	/** Guards rendering `MemberForm` until both the default namespace (STORY-122's
	 *  `resolveDefaultNamespace`) and the relation-field target options below have resolved —
	 *  mirrors the canvas's own `manageMembersConceptNamespaceLoaded` gate. */
	let addIdentityReady = $state(false);
	let addIdentityNamespaceBaseIri = $state<string>(DEFAULT_NAMESPACE_BASE_IRI);
	let addIdentityRelationTargetOptions = $state<Record<string, RelationTargetOption[]>>({});

	function namespacePrefixFor(namespaceBaseIri: string): string {
		return namespaceStore.namespaces.find((ns) => ns.baseIri === namespaceBaseIri)?.prefix ?? namespaceBaseIri;
	}

	/** `prefix:ClassName` for the class currently open in the Add-identity modal — shown in the
	 *  modal's title so the user can double-check they picked the class they meant to before filling
	 *  out the form, same disambiguation `IdentityResourcePage`'s type-badge chips use. */
	const addIdentityClassLabel = $derived.by(() => {
		if (!addIdentityClassIri) return null;
		const cls = classes.find((c) => c.iri === addIdentityClassIri);
		if (!cls) return null;
		return `${namespacePrefixFor(cls.namespaceBaseIri)}:${cls.label}`;
	});

	/** Mirrors `routes/+page.svelte`'s own `loadRelationTargetOptions` (canvas-scoped there) — scoped
	 *  to this route instead, with the same namespace-prefix-disambiguated label shape. */
	async function loadRelationTargetOptions(
		relationFields: CanvasRelationFieldSpec[]
	): Promise<Record<string, RelationTargetOption[]>> {
		const entries = await Promise.all(
			relationFields.map(async (rel) => {
				const options = await sparqlConnector.fetchIndividualsOfClass(rel.targetClassIri);
				return [
					rel.iri,
					options.map((o) => ({ iri: o.iri, label: `[${namespacePrefixFor(o.namespaceBaseIri)}] ${o.label}` }))
				] as const;
			})
		);
		return Object.fromEntries(entries);
	}

	async function openAddIdentityModal() {
		const classIriValue = lastFacets.classIri;
		if (!classIriValue || classIriValue === UNCLASSIFIED_FACET) return;
		addIdentityClassIri = classIriValue;
		addIdentityReady = false;
		addIdentityOpen = true;
		const relationFields = entityNodeByClassIri.get(classIriValue)?.relationFields ?? [];
		const [namespaceBaseIri, relationTargetOptions] = await Promise.all([
			resolveDefaultNamespace(classIriValue, entityNodeByClassIri),
			loadRelationTargetOptions(relationFields)
		]);
		addIdentityNamespaceBaseIri = namespaceBaseIri ?? DEFAULT_NAMESPACE_BASE_IRI;
		addIdentityRelationTargetOptions = relationTargetOptions;
		addIdentityReady = true;
	}

	function closeAddIdentityModal() {
		addIdentityOpen = false;
		addIdentityClassIri = null;
		addIdentityReady = false;
	}

	/** `MemberForm`'s create-mode `onSubmit` — calls STORY-122's `createIdentity` (no
	 *  `addWorkspaceMember`, research.md §6 decision 3), then re-runs the current search and
	 *  navigates to the new identity's resource page (research.md §5.1/§7) so the user immediately
	 *  sees what they just created. A thrown error (e.g. a duplicate label) propagates back to
	 *  `MemberForm`'s own `catch`, which displays it inline without closing the modal. */
	async function handleAddIdentitySubmit(
		label: string,
		namespaceBaseIri?: string,
		attributeSubmissions: AttributeValueSubmission[] = [],
		identifier?: string,
		relationSubmissions: RelationValueSubmission[] = []
	) {
		if (!addIdentityClassIri) return;
		const resolvedNamespaceBaseIri = namespaceBaseIri ?? addIdentityNamespaceBaseIri;
		const { iri } = await createIdentity(
			addIdentityClassIri,
			label,
			resolvedNamespaceBaseIri,
			attributeSubmissions,
			identifier,
			relationSubmissions
		);
		closeAddIdentityModal();
		await runSearch(lastFacets);
		selectNode({ iri, label });
	}

	function facetsEqual(a: IdentityFacetValues, b: IdentityFacetValues): boolean {
		return (
			a.query === b.query &&
			a.classIri === b.classIri &&
			a.namespaceBaseIri === b.namespaceBaseIri &&
			a.syncSource === b.syncSource &&
			a.syncStatus === b.syncStatus
		);
	}

	function pushBreadcrumb(ref: IdentityRef) {
		nodeCache.set(ref.iri, ref);
		const next = [...breadcrumb.filter((n) => n.iri !== ref.iri), ref];
		breadcrumb = next.slice(-BREADCRUMB_MAX);
	}

	function applySelection(ref: IdentityRef) {
		selectedIri = ref.iri;
		pushBreadcrumb(ref);
	}

	/** Fired once `IdentityResourcePage` resolves the identity's real label, to replace the
	 *  placeholder prettified-IRI label the breadcrumb entry started with. */
	function handleIdentityLoaded(ref: IdentityRef) {
		if (!breadcrumb.some((n) => n.iri === ref.iri)) return;
		pushBreadcrumb(ref);
	}

	function selectNode(ref: IdentityRef) {
		applySelection(ref);
		void goto(buildIdentitySearchUrl({ ...lastFacets, node: ref.iri }), {
			replaceState: false,
			noScroll: true,
			keepFocus: true
		});
	}

	function resolveAndSelectNode(iri: string) {
		const cached = nodeCache.get(iri) ?? results.find((r) => r.iri === iri);
		applySelection(cached ? { iri: cached.iri, label: cached.label } : { iri, label: prettifyLocalName(iri) });
	}

	function handleBack() {
		window.history.back();
	}

	/** `IdentityResourcePage`'s "Delete" action succeeded — drop the identity from every piece of
	 *  local state that might still reference it (the results list, the breadcrumb trail, the node
	 *  cache) and deselect it, since there's nothing left to show on the now-empty detail column.
	 *  Doesn't re-run the search: the deleted row disappearing from `results` client-side is enough,
	 *  and re-querying would also lose the user's current scroll position for no benefit. */
	function handleIdentityDeleted(iri: string) {
		results = results.filter((r) => r.iri !== iri);
		breadcrumb = breadcrumb.filter((n) => n.iri !== iri);
		nodeCache.delete(iri);
		selectedIri = null;
		void goto(buildIdentitySearchUrl({ ...lastFacets, node: null }), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	/** The edit form changed an identity's class: it leaves the list when it no longer matches the
	 *  active class filter (e.g. it was Unclassified), otherwise its row just takes the new class. */
	function handleIdentityClassChanged(iri: string, classIri: string) {
		const facet = lastFacets.classIri;
		const stillMatches =
			!facet || (facet !== UNCLASSIFIED_FACET && (expandClassFacet(facet) ?? []).includes(classIri));
		results = stillMatches
			? results.map((r) => (r.iri === iri ? { ...r, classIri } : r))
			: results.filter((r) => r.iri !== iri);
	}

	/** Expands a "Filter by class" facet selection into itself plus every transitive subclass, using
	 *  the cross-namespace `subClassOf` edges already loaded for the resource page's chip coloring —
	 *  `searchIndividuals`'s `classIri` param is an exact-type match only, so selecting an abstract
	 *  parent class (e.g. `core:Concept`) would otherwise silently miss every individual typed only
	 *  as one of its concrete subclasses (this repo runs no OWL2-RL reasoning to materialize those
	 *  supertype `rdf:type` triples itself). `undefined` when no class facet is selected. */
	function expandClassFacet(classIriValue: string | null): string[] | undefined {
		if (!classIriValue || classIriValue === UNCLASSIFIED_FACET) return undefined;
		const childrenBySuper = new Map<string, string[]>();
		for (const { sub, super: superIri } of subClassOf) {
			const children = childrenBySuper.get(superIri) ?? [];
			children.push(sub);
			childrenBySuper.set(superIri, children);
		}
		const closure = new Set<string>([classIriValue]);
		const queue = [classIriValue];
		while (queue.length > 0) {
			const current = queue.shift() as string;
			for (const child of childrenBySuper.get(current) ?? []) {
				if (!closure.has(child)) {
					closure.add(child);
					queue.push(child);
				}
			}
		}
		return [...closure];
	}

	async function runSearch(
		facets: IdentityFacetValues,
		opts: { fromUrl?: boolean; pendingNode?: string | null } = {}
	) {
		const { fromUrl = false, pendingNode = null } = opts;
		isLoading = true;
		error = null;
		lastFacets = facets;
		// Live search can overlap requests; only the newest one may write results.
		const seq = ++searchSeq;
		clearSelection();

		const unclassifiedMode = facets.classIri === UNCLASSIFIED_FACET;
		unclassifiedTotal = null;
		queryTooShort = unclassifiedMode && isUnclassifiedQueryTooShort(facets.query);
		if (queryTooShort) {
			results = [];
			hasMore = false;
			hasSearched = true;
			isLoading = false;
			return;
		}

		try {
			if (unclassifiedMode) {
				void sparqlConnector
					.countUnclassified({ query: facets.query || undefined, namespaceBaseIri: facets.namespaceBaseIri ?? undefined })
					.then((n) => {
						if (lastFacets === facets) unclassifiedTotal = n;
					})
					.catch(() => {});
			}
			const searchPage = await sparqlConnector.searchIndividuals({
				query: facets.query || undefined,
				classIris: expandClassFacet(facets.classIri),
				unclassified: facets.classIri === UNCLASSIFIED_FACET,
				namespaceBaseIri: facets.namespaceBaseIri ?? undefined,
				syncSource: facets.syncSource ?? undefined,
				syncStatus: facets.syncStatus ?? undefined,
				limit: PAGE_SIZE,
				offset: 0
			});
			if (seq !== searchSeq) return;
			results = searchPage.results;
			hasMore = searchPage.hasMore;
			nextOffset = PAGE_SIZE;
			hasSearched = true;
		} catch (err) {
			if (seq !== searchSeq) return;
			error = err instanceof Error ? err.message : 'Failed to search identities';
			results = [];
			hasMore = false;
		} finally {
			if (seq === searchSeq) isLoading = false;
		}

		if (fromUrl) {
			if (pendingNode) resolveAndSelectNode(pendingNode);
		} else {
			void goto(buildIdentitySearchUrl({ ...facets, node: selectedIri }), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}
	}

	async function loadMore() {
		isLoading = true;
		try {
			const searchPage = await sparqlConnector.searchIndividuals({
				query: lastFacets.query || undefined,
				classIris: expandClassFacet(lastFacets.classIri),
				unclassified: lastFacets.classIri === UNCLASSIFIED_FACET,
				namespaceBaseIri: lastFacets.namespaceBaseIri ?? undefined,
				syncSource: lastFacets.syncSource ?? undefined,
				syncStatus: lastFacets.syncStatus ?? undefined,
				limit: PAGE_SIZE,
				offset: nextOffset,
				after: lastFacets.classIri === UNCLASSIFIED_FACET ? keysetAfter(results) : undefined
			});
			results = [...results, ...searchPage.results];
			hasMore = searchPage.hasMore;
			nextOffset += PAGE_SIZE;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load more identities';
		} finally {
			isLoading = false;
		}
	}

	function handleClear() {
		lastFacets = EMPTY_FACETS;
		hasSearched = false;
		results = [];
		hasMore = false;
		selectedIri = null;
		breadcrumb = [];
		nodeCache.clear();
		void goto('/identities', { replaceState: true, noScroll: true, keepFocus: true });
	}

	// Keeps route state in sync with the URL: deep links, and the browser's own Back/Forward
	// (popstate), which changes `page.url` without going through `runSearch`/`selectNode` directly.
	// `untrack` keeps this effect from re-firing on the state updates it makes itself (those already
	// match the URL they just pushed).
	$effect(() => {
		const search = page.url.search;
		const parsed = parseIdentitySearchParams(search);

		untrack(() => {
			const facets: IdentityFacetValues = {
				query: parsed.query,
				classIri: parsed.classIri,
				namespaceBaseIri: parsed.namespaceBaseIri,
				syncSource: parsed.syncSource,
				syncStatus: parsed.syncStatus
			};
			if (!facetsEqual(facets, lastFacets)) {
				void runSearch(facets, { fromUrl: true, pendingNode: parsed.node });
			} else if (parsed.node !== selectedIri) {
				if (parsed.node) {
					resolveAndSelectNode(parsed.node);
				} else {
					selectedIri = null;
				}
			}
		});
	});

	/** Drops classes minted in the app's own reserved default namespace (`Note`, `Workspace`,
	 *  `AttributedRelationship`, `AppSettings`, `Namespace` — every one of `iri.ts`'s internal marker
	 *  classes lives there, self-declared `owl:Class` purely so their individuals/annotations can
	 *  carry a real `rdf:type`) before it ever reaches the class facet — none of them are real,
	 *  user-browsable identities, and `Note`/`Workspace` individuals are already unconditionally
	 *  excluded from `searchIndividuals`'s results, so offering them as a filter option that can never
	 *  match anything is just confusing (the bug this filters out). */
	function excludeReservedNamespaceClasses(fetchedClasses: FetchedClass[]): FetchedClass[] {
		return fetchedClasses.filter((c) => c.namespaceBaseIri !== DEFAULT_NAMESPACE_BASE_IRI);
	}

	onMount(() => {
		void namespaceStore.ensureLoaded();
		sparqlConnector
			.fetchFullSchemaForAllNamespaces()
			.then((schema) => {
				classes = excludeReservedNamespaceClasses(schema.classes);
				subClassOf = schema.subClassOf;
				fullSchema = schema;
			})
			.catch(() => {
				classes = [];
				subClassOf = [];
				fullSchema = EMPTY_SCHEMA;
			});
	});
</script>

<svelte:head>
	<title>Identities — RDF Schema Editor</title>
</svelte:head>

<div class="identities-page">
	<div class="identities-toolbar">
		<div class="search-bar-wrap">
			<IdentitySearchBar
				values={lastFacets}
				{classes}
				namespaces={namespaceStore.namespaces}
				{isLoading}
				onSearch={(values) => void runSearch(values)}
				onClear={handleClear}
			/>
		</div>
		<button
			type="button"
			class="add-identity-btn"
			disabled={!lastFacets.classIri || lastFacets.classIri === UNCLASSIFIED_FACET}
			title={lastFacets.classIri && lastFacets.classIri !== UNCLASSIFIED_FACET ? 'Add a new identity for this class' : 'Select a class to add an identity'}
			onclick={() => void openAddIdentityModal()}
		>
			+ Add identity
		</button>
	</div>

	{#if error}
		<div class="error-banner">
			<p>{error}</p>
			<button type="button" onclick={() => (error = null)}>Dismiss</button>
		</div>
	{/if}

	<div class="identities-columns">
		<div class="results-column">
			{#if queryTooShort}
				<p class="muted unclassified-note">Type at least 2 characters to search Unclassified individuals.</p>
			{:else if unclassifiedTotal !== null}
				<p class="muted unclassified-note">{unclassifiedTotal.toLocaleString()} Unclassified</p>
			{/if}
			{#if inUnclassifiedMode && !queryTooShort}
				<UnclassifiedBulkBar
					{selectionCount}
					{pageSelected}
					{allMatching}
					total={unclassifiedTotal}
					classOptions={bulkClassOptions}
					progress={bulkProgress}
					canUndo={lastBulk !== null}
					undoLabel={lastBulk?.label ?? ''}
					onSelectPage={selectPage}
					onSelectAllMatching={() => (allMatching = true)}
					onClear={clearSelection}
					onApply={(c) => void applyBulkClass(c)}
					onCancelRun={() => bulkAbort?.abort()}
					onUndo={() => void undoBulk()}
				/>
			{/if}
			<IdentityResultsList
				selectable={inUnclassifiedMode}
				{checkedIris}
				onToggleChecked={toggleChecked}
				{results}
				{selectedIri}
				{hasSearched}
				{hasMore}
				{isLoading}
				{classes}
				namespaces={namespaceStore.namespaces}
				onSelect={(r) => selectNode({ iri: r.iri, label: r.label })}
				onLoadMore={() => void loadMore()}
			/>
		</div>
		<div class="detail-column">
			{#if selectedIri}
				<IdentityResourcePage
					iri={selectedIri}
					{breadcrumb}
					{classes}
					namespaces={namespaceStore.namespaces}
					{classHierarchyIndex}
					{namespaceColorByBaseIri}
					{entityNodeByClassIri}
					activeClassFacet={lastFacets.classIri}
					onNavigate={selectNode}
					onBreadcrumbSelect={selectNode}
					onBack={handleBack}
					canGoBack={breadcrumb.length > 1}
					onLoaded={handleIdentityLoaded}
					onDeleted={handleIdentityDeleted}
					onClassChanged={handleIdentityClassChanged}
				/>
			{:else}
				<div class="detail-empty-state">
					<p class="muted">Select an identity to see its details.</p>
				</div>
			{/if}
		</div>
	</div>
</div>

<Modal
	isOpen={addIdentityOpen}
	title={addIdentityClassLabel ? `Add ${addIdentityClassLabel} Identity` : 'Add Identity'}
	onClose={closeAddIdentityModal}
	dismissible={false}
>
	{#if addIdentityReady && addIdentityClassIri}
		<MemberForm
			mode="create"
			namespaceOptions={namespaceStore.namespaces}
			initialNamespaceBaseIri={addIdentityNamespaceBaseIri}
			submitLabel="Add"
			onCancel={closeAddIdentityModal}
			onSubmit={handleAddIdentitySubmit}
			attributes={entityNodeByClassIri.get(addIdentityClassIri)?.attributes ?? []}
			labelRequired={entityNodeByClassIri.get(addIdentityClassIri)?.labelRequired ?? false}
			relationFields={entityNodeByClassIri.get(addIdentityClassIri)?.relationFields ?? []}
			relationTargetOptions={addIdentityRelationTargetOptions}
		/>
	{:else}
		<p class="muted">Loading…</p>
	{/if}
</Modal>

<style>
	.identities-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
	}

	.identities-toolbar {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.search-bar-wrap {
		flex: 1;
		min-width: 0;
	}

	.add-identity-btn {
		flex-shrink: 0;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.9rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.add-identity-btn:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg-secondary);
	}

	.add-identity-btn:disabled {
		opacity: 0.5;
		cursor: default;
		border-color: var(--color-border);
		color: var(--color-text-muted);
	}

	.identities-columns {
		display: flex;
		flex: 1;
		min-height: 0;
		gap: 1rem;
	}

	.results-column {
		flex: 0 0 380px;
		min-width: 280px;
		height: 100%;
	}

	.detail-column {
		flex: 1;
		min-width: 0;
		height: 100%;
	}

	.detail-empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 8px;
	}

	.detail-empty-state .muted,
	.muted {
		color: var(--color-text-muted);
	}

	.error-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--color-error-bg);
		border: 1px solid var(--color-error);
		border-radius: 6px;
	}

	.error-banner p {
		color: var(--color-error);
		margin: 0;
	}

	.error-banner button {
		color: var(--color-error);
		font-size: 0.85rem;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
	}

	@media (max-width: 768px) {
		.identities-columns {
			flex-direction: column;
		}

		.results-column {
			flex: 0 0 45%;
			min-width: 0;
			height: auto;
		}

		.detail-column {
			flex: 1;
			min-height: 0;
			height: auto;
		}
	}

	.unclassified-note {
		margin: 0.25rem 0.75rem;
		font-size: 0.85rem;
	}
</style>
