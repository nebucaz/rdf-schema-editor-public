<script lang="ts">
	/** The core vocabulary (ontology-pipeline STORY-323): browse, search and edit SKOS concepts, move
	 *  them along their lifecycle and keep a scope record per scheme. Stage 1 of the pipeline. */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import BackfillConceptsModal from '#lib/components/BackfillConceptsModal.svelte';
	import VocabularyCollectionsTab from '#lib/components/VocabularyCollectionsTab.svelte';
	import CopyLinkButton from '#lib/components/CopyLinkButton.svelte';
	import ImportVocabularyModal from '#lib/components/ImportVocabularyModal.svelte';
	import ExportVocabularyModal from '#lib/components/ExportVocabularyModal.svelte';
	import type { BusinessUnit } from '#lib/services/business-unit.js';
	import ConceptForm from '#lib/components/ConceptForm.svelte';
	import ConceptNeighborhood from '#lib/components/ConceptNeighborhood.svelte';
	import ConceptHistory from '#lib/components/ConceptHistory.svelte';
	import VocabularyConceptsTab from '#lib/components/VocabularyConceptsTab.svelte';
	import ConceptRelations from '#lib/components/ConceptRelations.svelte';
	import DeprecateConceptDialog from '#lib/components/DeprecateConceptDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import MergeConceptDialog from '#lib/components/MergeConceptDialog.svelte';
	import PromoteConceptDialog from '#lib/components/PromoteConceptDialog.svelte';
	import type { MergePlan } from '#lib/services/concept-merge.js';
	import { planEnumeratedClass } from '#lib/services/concept-to-class.js';
	import VocabularySchemesTab from '#lib/components/VocabularySchemesTab.svelte';
	import VocabularyTabs from '#lib/components/VocabularyTabs.svelte';
	import VocabularyNamespacePicker from '#lib/components/VocabularyNamespacePicker.svelte';
	import { planBackfillWrites, proposeBackfill, type BackfillProposal, type BackfillRow } from '#lib/services/concept-backfill.js';
	import { changeKindForConceptEdit, conceptChangeSummary, conceptHistory, relationEntry, type ChangeLogEntryInput, type HistoryNote } from '#lib/services/change-log.js';
	import { fetchChangeLog } from '#lib/services/changelog-client.js';
	import type { SchemeMetadata } from '#lib/services/scheme-metadata.js';
	import { recordChange } from '#lib/services/change-log-actions.js';
	import { reviewConceptUrl, reviewSchemeUrl } from '#lib/services/review-links.js';
	import { schemeIdForIri } from '#lib/services/scheme-id.js';
	import type { CollectionDraft, SkosCollection } from '#lib/services/skos-collection.js';
	import { applyImport, type ImportWrites } from '#lib/services/skos-import-apply.js';
	import type { SkosVocabulary } from '#lib/services/skos-export.js';
	import { buildExportFiles, type ExportSettings } from '#lib/services/skos-export-actions.js';
	import { downloadFile } from '#lib/utils/download.js';
	import { runVocabularyGates } from '#lib/services/gates/vocabulary.js';
	import {
		conceptTitle,
		nextStatuses,
		taggedTexts,
		schemeDisplayName,
		type Concept,
		type ConceptDraft,
		type ConceptScheme,
		type RelationKind,
		type SchemeScope
	} from '#lib/services/skos-concept.js';
	import { sparqlConnector, type FetchedExternalVocabulary } from '#lib/services/sparql-connector.js';
	import { addAlternativeToConcept, deprecateConcept, loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { listStateHref, parseListUrlState, patchListState, type ListUrlState, type VocabularyTab } from '#lib/services/list-url-state.js';
	import { stripBase } from '#lib/utils/urls.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	/** Concepts are read in pages of this size into `concepts`, the context the gates and pickers need. */
	const CONTEXT_PAGE_SIZE = 1000;
	const CONTEXT_MAX_PAGES = 10;

	/** The tab lives in the URL (`?tab=`), so a link, the back button and a reload all land on the same tab; the
	 *  vocabulary itself stays loaded on this page while the tab changes. */
	const listState = $derived(parseListUrlState(page.url.searchParams));
	const tab = $derived(listState.tab);
	function setListState(next: ListUrlState) {
		void goto(listStateHref(stripBase(page.url.pathname), page.url.searchParams, next), { replace: true, reset: false });
	}
	/** A neighbour in the Neighbourhood section becomes the selected concept, and `?concept=` follows. */
	/** The scheme to show selected when the Schemes tab opens from the neighbourhood graph. */
	let schemeToOpen = $state<string | null>(null);
	function openScheme(iri: string) {
		schemeToOpen = iri;
		selectTab('schemes');
	}

	function selectNeighbour(iri: string) {
		selectedIri = iri;
		const params = new URLSearchParams(page.url.searchParams.toString());
		params.set('concept', iri);
		void goto(listStateHref(stripBase(page.url.pathname), params, listState), { replace: true, reset: false });
	}
	const selectTab = (next: VocabularyTab) => setListState(patchListState(listState, { tab: next }));
	/** Bumped after every load so the Concepts tab reads its page again after a write. */
	let reloadKey = $state(0);

	/** `undefined` while loading, `null` when no namespace is marked yet. */
	let core = $state<string | null | undefined>(undefined);
	let concepts = $state<Concept[]>([]);
	let schemes = $state<ConceptScheme[]>([]);
	let externals = $state<FetchedExternalVocabulary[]>([]);
	let collections = $state<SkosCollection[]>([]);
	let exporting = $state(false);
	/** The whole vocabulary while the import wizard is open, for the preview to compare with. */
	let importing = $state<SkosVocabulary | null>(null);
	let error = $state<string | null>(null);
	let selectedIri = $state<string | null>(null);
	/** `null` = closed, `'new'` = adding, otherwise the concept being edited. */
	let editing = $state<Concept | 'new' | null>(null);
	let deprecating = $state<Concept | null>(null);
	let promoting = $state<Concept | null>(null);
	/** The duplicate being merged, with the classes that point at it. */
	let merging = $state<{ concept: Concept; classLinks: { classIri: string; label: string }[] } | null>(null);
	/** `null` = closed; otherwise the proposals of the open backfill review. */
	let backfill = $state<{ proposals: BackfillProposal[]; concepts: Concept[] } | null>(null);
	let confirmingDelete = $state<{ iri: string; linkedClasses: string[]; narrower: string[]; collections: string[] } | null>(null);
	/** Why the concept or relation is being changed; written to the change log with the change. */
	let rationale = $state('');
	let relationRationale = $state('');

	/** Gates run over the concepts already loaded: no query of their own. */
	const findings = $derived(runVocabularyGates(concepts));
	const selectedFindings = $derived(findings.filter((f) => f.elementIri === selectedIri));
	const selected = $derived(concepts.find((c) => c.iri === selectedIri) ?? null);
	const schemeName = $derived(new Map(schemes.map((s) => [s.iri, schemeDisplayName(s)])));
	const labelOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? conceptTitle(c) : (iri.split(/[#/]/).pop() ?? iri);
	};

	let businessUnits = $state<BusinessUnit[]>([]);

	async function load() {
		error = null;
		try {
			await namespaceStore.refresh();
			core = await sparqlConnector.fetchVocabularyNamespace();
			// Best effort: a failed backfill must not keep the page from loading.
			if (core) await sparqlConnector.ensureHasTopConcept(core).catch(() => {});
			if (!core) return;
			const [loadedSchemes, loadedConcepts, loadedExternals, loadedCollections] = await Promise.all([
				sparqlConnector.fetchConceptSchemes(core),
				loadAllConcepts(
					{ fetchVocabularyNamespace: async () => core ?? null, fetchConcepts: (c, o) => sparqlConnector.fetchConcepts(c, o) },
					CONTEXT_PAGE_SIZE,
					CONTEXT_MAX_PAGES
				),
				sparqlConnector.fetchExternalVocabularies(),
				sparqlConnector.fetchCollections(core)
			]);
			// Best effort: without the list the form can still link the concept's current unit and create a new one.
			businessUnits = await sparqlConnector.fetchBusinessUnits(core).catch(() => []);
			collections = loadedCollections;
			schemes = loadedSchemes;
			externals = loadedExternals;
			concepts = loadedConcepts ?? [];
			reloadKey++;
			// A link from the Model checks: `/vocabulary?concept=<iri>`.
			const wanted = page.url.searchParams.get('concept');
			if (wanted && !selectedIri && concepts.some((c) => c.iri === wanted)) selectedIri = wanted;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the vocabulary';
		}
	}

	/** Runs `action`, then reloads; a failure shows in the page banner. */
	async function act(action: () => Promise<void>) {
		error = null;
		try {
			await action();
			await load();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	/** The selected concept's generated history (`skos:historyNote`), read from the change log. */
	let history = $state<HistoryNote[]>([]);
	$effect(() => {
		const iri = selectedIri;
		history = [];
		if (!iri) return;
		fetchChangeLog((...args) => fetch(...args), { term: iri })
			.then((items) => {
				if (selectedIri === iri) history = conceptHistory(items, iri);
			})
			.catch(() => {});
	});

	/** Records a change after it was made and reloaded; a failing log write is shown, the change stays. */
	async function log(entry: ChangeLogEntryInput) {
		const problem = await recordChange(entry);
		if (problem) error = problem;
	}

	async function markNamespace(baseIri: string) {
		await sparqlConnector.updateNamespaceVocabulary(baseIri, true);
		await load();
	}

	async function save(draft: ConceptDraft) {
		if (!core) return;
		const before = editing && editing !== 'new' ? editing : null;
		if (before) await sparqlConnector.updateConcept(core, before.iri, draft);
		else selectedIri = await sparqlConnector.insertConcept(core, draft);
		const entry: ChangeLogEntryInput = {
			kind: 'change',
			summary: conceptChangeSummary(before ? 'edited' : 'added', draft),
			rationale,
			term: before ? before.iri : (selectedIri ?? undefined),
			changeKind: before ? changeKindForConceptEdit(before, draft) : 'addition'
		};
		editing = null;
		rationale = '';
		await load();
		await log(entry);
	}

	async function addAlternative(conceptIri: string, text: string, lang: string) {
		if (!core) return;
		await addAlternativeToConcept(sparqlConnector, core, concepts, conceptIri, text, lang);
		const target = concepts.find((c) => c.iri === conceptIri);
		const entry: ChangeLogEntryInput = {
			kind: 'change',
			summary: `Added alternative label "${text}" to concept "${target ? conceptTitle(target) : conceptIri}"`,
			rationale,
			term: conceptIri,
			changeKind: 'label'
		};
		editing = null;
		rationale = '';
		selectedIri = conceptIri;
		await load();
		await log(entry);
	}

	async function addRelation(kind: RelationKind, target: string) {
		if (!core || !selected) return;
		const entry = relationEntry('added', selected, `skos:${kind}`, target, relationRationale);
		await sparqlConnector.addConceptRelation(core, selected.iri, kind, target);
		relationRationale = '';
		await load();
		await log(entry);
	}

	async function removeRelation(kind: RelationKind, target: string) {
		if (!core || !selected) return;
		const entry = relationEntry('removed', selected, `skos:${kind}`, target, relationRationale);
		await sparqlConnector.removeConceptRelation(core, selected.iri, kind, target);
		relationRationale = '';
		await load();
		await log(entry);
	}

	async function advance(concept: Concept) {
		const [next] = nextStatuses(concept.status);
		if (!core || !next) return;
		await act(() => sparqlConnector.setConceptStatus(core!, concept.iri, next));
		await log({ kind: 'change', summary: `Marked concept "${conceptTitle(concept)}" ${next}`, term: concept.iri, changeKind: 'other' });
	}

	async function confirmDeprecate(choice: { reason: string; replacedBy: string; moveLabel: boolean }) {
		if (!core || !deprecating) return;
		await deprecateConcept(sparqlConnector, core, deprecating, choice, concepts);
		const entry: ChangeLogEntryInput = {
			kind: 'change',
			summary: conceptChangeSummary('deprecated', deprecating),
			rationale: choice.reason,
			term: deprecating.iri,
			changeKind: 'other'
		};
		deprecating = null;
		await load();
		await log(entry);
	}

	async function remove(concept: Concept, force = false) {
		if (!core) return;
		let deletedEntry: ChangeLogEntryInput | null = null;
		await act(async () => {
			const result = await sparqlConnector.deleteConcept(core!, concept.iri, { force });
			if (result.deleted) {
				confirmingDelete = null;
				selectedIri = null;
				deletedEntry = { kind: 'change', summary: conceptChangeSummary('deleted', concept), term: concept.iri, changeKind: 'removal' };
			} else {
				confirmingDelete = { iri: concept.iri, linkedClasses: result.linkedClasses, narrower: result.narrower, collections: result.collections };
			}
		});
		if (deletedEntry) await log(deletedEntry);
	}

	async function confirmPromote(namespaceBaseIri: string) {
		if (!core || !promoting) return;
		await sparqlConnector.promoteConceptToClass(core, promoting.iri, namespaceBaseIri);
		schemaStore.invalidate();
		const entry: ChangeLogEntryInput = {
			kind: 'change',
			summary: conceptChangeSummary('promoted', promoting) + ' to a class',
			term: promoting.iri,
			changeKind: 'addition'
		};
		promoting = null;
		await load();
		await log(entry);
	}

	async function openMerge(concept: Concept) {
		await act(async () => {
			const schema = await schemaStore.ensureLoaded('schema');
			const classLinks = schema.classes
				.filter((k) => k.definedByConcept === concept.iri)
				.map((k) => ({ classIri: k.iri, label: k.label }));
			merging = { concept, classLinks };
		});
	}

	async function confirmMerge(plan: MergePlan) {
		if (!core || !merging) return;
		const duplicate = merging.concept;
		const survivorTitle = labelOf(plan.survivor);
		await sparqlConnector.mergeConcepts(core, plan);
		schemaStore.invalidate();
		const entry: ChangeLogEntryInput = {
			kind: 'change',
			summary: `Merged "${conceptTitle(duplicate)}" into "${survivorTitle}"`,
			term: plan.survivor,
			changeKind: 'merge'
		};
		merging = null;
		selectedIri = plan.survivor;
		await load();
		await log(entry);
	}

	/** Reads the classes and every concept, then proposes a concept for each unlinked class. */
	async function openBackfill() {
		if (!core) return;
		await act(async () => {
			const [schema, allConcepts] = await Promise.all([
				schemaStore.ensureLoaded('schema'),
				loadAllConcepts(sparqlConnector)
			]);
			backfill = { proposals: proposeBackfill(schema.classes, allConcepts ?? [], core!), concepts: allConcepts ?? [] };
		});
	}

	async function acceptBackfill(rows: BackfillRow[]) {
		if (!core || !backfill) return;
		const { writes, errors } = planBackfillWrites(rows, backfill.concepts, core);
		if (errors.length) {
			const label = (iri: string) => rows.find((r) => r.classIri === iri)?.label.trim() || iri;
			throw new Error(errors.map((e) => `${label(e.classIri)}: ${e.message}`).join(' '));
		}
		await sparqlConnector.createConceptsForClasses(core, writes);
		// One refresh for the whole batch.
		schemaStore.invalidate();
		await load();
		backfill = { ...backfill, concepts: (await loadAllConcepts(sparqlConnector)) ?? [] };
	}

	/** Creates a scheme and resolves with its IRI; a failure reaches the form, which shows it beside the fields. */
	async function addScheme(draft: { name: string; description: string }): Promise<string> {
		const iri = await sparqlConnector.insertConceptScheme(core!, draft);
		await load();
		return iri;
	}

	/** Collection edits: write, reload, and let a failure reach the panel, which shows it beside the control. */
	async function collectionAction(action: () => Promise<unknown>) {
		if (!core) return;
		try {
			await action();
		} finally {
			await load();
		}
	}
	const createCollection = (draft: CollectionDraft) => collectionAction(() => sparqlConnector.insertCollection(core!, draft));
	const saveCollectionLabels = (iri: string, labels: Parameters<typeof sparqlConnector.updateCollectionLabels>[2]) =>
		collectionAction(() => sparqlConnector.updateCollectionLabels(core!, iri, labels));
	const addCollectionMember = (iri: string, member: string) => collectionAction(() => sparqlConnector.addCollectionMember(core!, iri, member));
	const removeCollectionMember = (iri: string, member: string) => collectionAction(() => sparqlConnector.removeCollectionMember(core!, iri, member));
	const reorderCollection = (iri: string, members: string[]) => collectionAction(() => sparqlConnector.reorderCollection(core!, iri, members));
	/** Turns a collection into an enumerated class (labels only, no link back to the concepts), in one write. */
	async function createEnumeratedClass(collectionIri: string, namespaceBaseIri: string): Promise<string> {
		const col = collections.find((x) => x.iri === collectionIri);
		if (!col) throw new Error('Collection not found');
		const plan = planEnumeratedClass(col, collections, concepts);
		if (plan.error) throw new Error(plan.error);
		const result = await sparqlConnector.insertEnumeratedClass(namespaceBaseIri, plan.className, plan.members.map((m) => m.label));
		schemaStore.invalidate();
		await log({
			kind: 'change',
			summary: `Created the enumerated class "${plan.className}" from a collection with ${result.members.length} members`,
			term: result.iri,
			changeKind: 'addition'
		});
		return `Created class "${plan.className}" with ${result.members.length} members.`;
	}

	/** Without `force` a scheme with concepts or references is refused and what blocks it comes back. */
	async function deleteScheme(iri: string, force: boolean) {
		const scheme = schemes.find((x) => x.iri === iri);
		const result = await sparqlConnector.deleteConceptScheme(core!, iri, { force });
		if (result.deleted) {
			schemaStore.invalidate();
			await load();
			await log({
				kind: 'change',
				summary: `Deleted the scheme "${scheme ? schemeDisplayName(scheme) : iri}" with ${result.concepts.length} concepts`,
				term: iri,
				changeKind: 'removal'
			});
		}
		return result;
	}

	async function deleteCollection(iri: string, force: boolean) {
		let result = { deleted: false, members: [] as string[] };
		await collectionAction(async () => {
			result = await sparqlConnector.deleteCollection(core!, iri, { force });
		});
		return result;
	}

	/** Reads everything the export needs (all concepts, class links) and hands the files to the browser. Writes nothing. */
	async function runExport(settings: ExportSettings) {
		exporting = false;
		error = null;
		try {
			const all = (await loadAllConcepts(sparqlConnector)) ?? [];
			const schema = settings.classExactMatch ? await schemaStore.ensureLoaded('schema') : null;
			const classLinks = (schema?.classes ?? [])
				.filter((c) => c.definedByConcept)
				.map((c) => ({ classIri: c.iri, conceptIri: c.definedByConcept! }));
			for (const file of buildExportFiles({ schemes, concepts: all, collections, classLinks }, settings)) {
				downloadFile(file.name, file.content, file.mime);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'The export failed';
		}
	}

	async function openImport() {
		if (!core) return;
		error = null;
		try {
			importing = { schemes, concepts: (await loadAllConcepts(sparqlConnector)) ?? [], collections };
		} catch (e) {
			error = e instanceof Error ? e.message : 'The vocabulary could not be read';
		}
	}

	async function runImport(writes: ImportWrites) {
		const outcome = await applyImport(
			{
				applyImportPlan: (base, w) => sparqlConnector.applyImportPlan(base, w),
				recordChange,
				loadConcepts: async () => (await loadAllConcepts(sparqlConnector)) ?? []
			},
			core!,
			writes
		);
		await load();
		return outcome;
	}

	async function saveMetadata(schemeIri: string, metadata: SchemeMetadata) {
		if (!core) return;
		await sparqlConnector.updateConceptSchemeMetadata(core, schemeIri, metadata);
		await load();
	}

	async function saveScope(schemeIri: string, scope: SchemeScope) {
		if (!core) return;
		await sparqlConnector.updateConceptSchemeScope(core, schemeIri, scope);
		await load();
	}

	onMount(() => {
		if (page.data.user) void load();
	});
</script>

<svelte:head>
	<title>Vocabulary — RDF Schema Editor</title>
</svelte:head>

<div class="vocabulary-page">
	<header>
		<h1>Vocabulary</h1>
		{#if core}
			<span class="header-actions">
				<CopyLinkButton path="/review/glossary" label="Copy link to the read-only glossary" />
				<button type="button" onclick={openImport} data-testid="import-vocabulary">Import</button>
				<button type="button" onclick={() => (exporting = true)} data-testid="export-vocabulary">Export</button>
			</span>
		{/if}
	</header>

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	{#if core === undefined}
		<p>Loading…</p>
	{:else if core === null}
		<VocabularyNamespacePicker namespaces={namespaceStore.namespaces} onMark={markNamespace} />
	{:else}
		<VocabularyTabs {tab} onSelect={selectTab} />

		{#if tab === 'concepts'}
		<div class="columns">
			<section class="list">
				{#if core}
					<VocabularyConceptsTab
						{core}
						connector={sparqlConnector}
						{schemes}
						{findings}
						{selectedIri}
						{reloadKey}
						{listState}
						onStateChange={setListState}
						onSelect={(iri) => (selectedIri = iri)}
						onAdd={() => (editing = 'new')}
						onBackfill={openBackfill}
					/>
				{/if}
			</section>

			<section class="detail" aria-label="Concept">
				{#if selected}
					<h2>
						{conceptTitle(selected)}
						<a class="share" href={reviewConceptUrl(selected.iri)} data-testid="review-link" title="Read-only page to share" aria-label="Read-only page to share">
							<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
								<line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
							</svg>
						</a>
					</h2>
					<p class="status-line">
						<span class="badge status-{selected.status}">{selected.status}</span>
						{#if selected.schemeIri}in {schemeName.get(selected.schemeIri) ?? selected.schemeIri}{/if}
						{#if selected.topConcept}<span class="hint">(top concept)</span>{/if}
					</p>
					<dl>
						<dt>Definition <code>skos:definition</code></dt>
						{#each taggedTexts(selected.definitions) as text (text)}<dd>{text}</dd>{:else}<dd>—</dd>{/each}
						{#if taggedTexts(selected.scopeNotes).length}
							<dt>Scope note <code>skos:scopeNote</code></dt>
							{#each taggedTexts(selected.scopeNotes) as text (text)}<dd>{text}</dd>{/each}
						{/if}
						<dt>Preferred <code>skos:prefLabel</code></dt>
						<dd>{taggedTexts(selected.prefLabels).join(', ')}</dd>
						{#if taggedTexts(selected.altLabels).length}
							<dt>Alternative <code>skos:altLabel</code></dt>
							<dd>{taggedTexts(selected.altLabels).join(', ')}</dd>
						{/if}
						{#if taggedTexts(selected.hiddenLabels).length}
							<dt>Hidden <code>skos:hiddenLabel</code></dt>
							<dd>{taggedTexts(selected.hiddenLabels).join(', ')}</dd>
						{/if}
						{#if selected.notation?.length}
							<dt>Notation <code>skos:notation</code></dt>
							<dd>{selected.notation.join(', ')}</dd>
						{/if}
						{#if selected.example?.length}
							<dt>Examples <code>skos:example</code></dt>
							<dd>{selected.example.join('; ')}</dd>
						{/if}
						{#if selected.editorialNote?.length}
							<dt>Editorial notes <code>skos:editorialNote</code> (internal)</dt>
							<dd>{selected.editorialNote.join('; ')}</dd>
						{/if}
						{#if selected.source || selected.authority}
							<dt>Provenance</dt>
							<dd>{[selected.source, selected.authority].filter(Boolean).join(' · ')}</dd>
						{/if}
						{#if selected.status === 'deprecated' || selected.status === 'retired'}
							<dt>Deprecated</dt>
							<dd>
								{selected.deprecationReason}
								{#if selected.deprecatedOn}({selected.deprecatedOn}){/if}
								{#if selected.replacedBy}· replaced by <button type="button" class="link" onclick={() => (selectedIri = selected.replacedBy)}>{labelOf(selected.replacedBy)}</button>{/if}
							</dd>
						{/if}
						{#if selected.created}
							<dt>Created / modified</dt>
							<dd>{selected.created} / {selected.modified}</dd>
						{/if}
					</dl>
					<ConceptHistory {history} />
					{#if selectedFindings.length}
						<ul class="findings-list" aria-label="Gate findings">
							{#each selectedFindings as f (f.gateId)}
								<li class:info={f.severity === 'info'}>{f.message}</li>
							{/each}
						</ul>
					{/if}
					<ConceptNeighborhood {concepts} iri={selected.iri} onSelect={selectNeighbour} {schemes} onSelectScheme={openScheme} />
					<ConceptRelations concept={selected} {concepts} {externals} onAdd={addRelation} onRemove={removeRelation} bind:rationale={relationRationale} />
					<div class="actions">
						<button type="button" onclick={() => (editing = selected)}>Edit</button>
						{#if selected.status === 'approved' || selected.status === 'active'}
							<button type="button" onclick={() => (promoting = selected)}>Promote to class…</button>
						{/if}
						{#if selected.status === 'active'}
							<button type="button" onclick={() => (deprecating = selected)}>Deprecate…</button>
						{:else if nextStatuses(selected.status)[0]}
							<button type="button" onclick={() => advance(selected)}>Mark {nextStatuses(selected.status)[0]}</button>
						{/if}
						{#if selected.status !== 'retired'}
							<button type="button" onclick={() => openMerge(selected)}>Merge into…</button>
						{/if}
						<button type="button" class="danger" onclick={() => remove(selected)}>Delete</button>
					</div>
					{#if confirmingDelete && confirmingDelete.iri === selected.iri}
						<div class="warning" role="alert">
							<p>
								This concept is still in use:
								{confirmingDelete.linkedClasses.length} linked class{confirmingDelete.linkedClasses.length === 1 ? '' : 'es'},
								{confirmingDelete.narrower.length} narrower concept{confirmingDelete.narrower.length === 1 ? '' : 's'},
								{confirmingDelete.collections.length} collection{confirmingDelete.collections.length === 1 ? '' : 's'}.
								Deleting it removes those links. Deprecating keeps them.
							</p>
							<button type="button" class="danger" onclick={() => remove(selected, true)}>Delete anyway</button>
							<button type="button" onclick={() => (confirmingDelete = null)}>Keep</button>
						</div>
					{/if}
				{:else}
					<p class="empty">Select a concept to see its definition and history.</p>
				{/if}
			</section>
		</div>
		{/if}

		{#if tab === 'collections'}
		<VocabularyCollectionsTab
			{collections}
			{concepts}
			namespaces={namespaceStore.namespaces.filter((n) => !n.vocabulary)}
			{listState}
			onStateChange={setListState}
			onCreate={createCollection}
			onSaveLabels={saveCollectionLabels}
			onAddMember={addCollectionMember}
			onRemoveMember={removeCollectionMember}
			onReorder={reorderCollection}
			onDelete={deleteCollection}
			onCreateEnumeration={createEnumeratedClass}
		/>
		{/if}

		{#if tab === 'schemes'}
		<VocabularySchemesTab
			core={core}
			initialSelectedIri={schemeToOpen}
			{schemes}
			{concepts}
			{listState}
			onStateChange={setListState}
			onAdd={addScheme}
			onSaveScope={saveScope}
			onSaveMetadata={saveMetadata}
			onDelete={deleteScheme}
		/>
		{/if}
	{/if}
</div>

{#if importing}
	<ImportVocabularyModal isOpen existing={importing} coreBaseIri={core ?? undefined} onApply={runImport} onClose={() => (importing = null)} />
{/if}

<ExportVocabularyModal isOpen={exporting} {schemes} onExport={runExport} onClose={() => (exporting = false)} />

<Modal
	isOpen={editing !== null}
	title={editing === 'new' ? 'Add concept' : 'Edit concept'}
	onClose={() => (editing = null)}
	maxWidth="640px"
	dismissible={false}
>
	{#if editing !== null}
		<ConceptForm
			initial={editing === 'new' ? undefined : editing}
			{schemes}
			existing={concepts}
			onSave={save}
			onCancel={() => (editing = null)}
			onAddAlternative={addAlternative}
			{collections}
			{businessUnits}
			bind:rationale
		/>
	{/if}
</Modal>

<Modal isOpen={promoting !== null} title="Promote to class" onClose={() => (promoting = null)} maxWidth="520px" dismissible={false}>
	{#if promoting}
		<PromoteConceptDialog
			conceptTitle={conceptTitle(promoting)}
			concept={promoting}
			namespaces={namespaceStore.namespaces}
			onConfirm={confirmPromote}
			onCancel={() => (promoting = null)}
		/>
	{/if}
</Modal>

<Modal isOpen={merging !== null} title="Merge concept" onClose={() => (merging = null)} maxWidth="620px" dismissible={false}>
	{#if merging}
		<MergeConceptDialog
			duplicate={merging.concept}
			{concepts}
			{collections}
			classLinks={merging.classLinks}
			onConfirm={confirmMerge}
			onCancel={() => (merging = null)}
		/>
	{/if}
</Modal>

<BackfillConceptsModal
	isOpen={backfill !== null}
	proposals={backfill?.proposals ?? []}
	conceptTitles={new Map((backfill?.concepts ?? []).map((c) => [c.iri, conceptTitle(c)]))}
	onAccept={acceptBackfill}
	onClose={() => (backfill = null)}
/>

<Modal isOpen={deprecating !== null} title="Deprecate concept" onClose={() => (deprecating = null)} maxWidth="560px" dismissible={false}>
	{#if deprecating}
		<DeprecateConceptDialog concept={deprecating} candidates={concepts} onConfirm={confirmDeprecate} onCancel={() => (deprecating = null)} />
	{/if}
</Modal>

<style>
	.vocabulary-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}

	h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.header-actions button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
	}

	.header-actions button:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.header-actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.columns {
		display: grid;
		grid-template-columns: minmax(16rem, 1fr) minmax(18rem, 2fr);
		gap: 1.5rem;
	}

	@media (max-width: 720px) {
		.columns {
			grid-template-columns: 1fr;
		}
	}

	dl {
		display: grid;
		gap: 0.15rem 0;
		margin: 0.5rem 0 1rem;
		font-size: 0.9rem;
	}

	dt {
		color: var(--color-text-muted);
		font-size: 0.8rem;
		margin-top: 0.5rem;
	}

	dd {
		margin: 0;
	}

	code {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.badge {
		font-size: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0.05rem 0.5rem;
	}

	.share {
		color: var(--color-text-muted);
		margin-left: 0.4rem;
		vertical-align: middle;
	}

	.share:hover {
		color: var(--color-accent);
	}

	.status-line {
		margin: 0;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.actions {
		margin-top: 1rem;
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.findings-list {
		margin: 0 0 1rem;
		padding-left: 1.1rem;
		font-size: 0.85rem;
		color: var(--color-error);
	}

	.findings-list .info {
		color: var(--color-text-muted);
	}

	.warning {
		margin-top: 0.75rem;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-error);
		border-radius: 6px;
		font-size: 0.85rem;
	}





	.link {
		background: none;
		border: none;
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}

	.hint,
	.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.error {
		color: var(--color-error);
	}

	.actions button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
	}

	.actions button:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.actions button.danger {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.actions button.danger:hover:not(:disabled) {
		background: var(--color-error);
		color: var(--color-bg);
	}

	.danger {
		color: var(--color-error);
	}
</style>
