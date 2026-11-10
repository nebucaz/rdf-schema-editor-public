<script lang="ts">
	/** The core vocabulary (ontology-pipeline STORY-323): browse, search and edit SKOS concepts, move
	 *  them along their lifecycle and keep a scope record per scheme. Stage 1 of the pipeline. */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import BackfillConceptsModal from '#lib/components/BackfillConceptsModal.svelte';
	import ConceptForm from '#lib/components/ConceptForm.svelte';
	import ConceptList from '#lib/components/ConceptList.svelte';
	import ConceptRelations from '#lib/components/ConceptRelations.svelte';
	import DeprecateConceptDialog from '#lib/components/DeprecateConceptDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import PromoteConceptDialog from '#lib/components/PromoteConceptDialog.svelte';
	import SchemeScopeForm from '#lib/components/SchemeScopeForm.svelte';
	import VocabularyNamespacePicker from '#lib/components/VocabularyNamespacePicker.svelte';
	import { planBackfillWrites, proposeBackfill, type BackfillProposal, type BackfillRow } from '#lib/services/concept-backfill.js';
	import { changeKindForConceptEdit, conceptChangeSummary, relationEntry, type ChangeLogEntryInput } from '#lib/services/change-log.js';
	import { recordChange } from '#lib/services/change-log-actions.js';
	import { reviewConceptUrl } from '#lib/services/review-links.js';
	import { runVocabularyGates } from '#lib/services/gates/vocabulary.js';
	import {
		conceptTitle,
		nextStatuses,
		type Concept,
		type ConceptDraft,
		type ConceptScheme,
		type RelationKind,
		type SchemeScope
	} from '#lib/services/skos-concept.js';
	import { sparqlConnector, type FetchedExternalVocabulary } from '#lib/services/sparql-connector.js';
	import { addAlternativeToConcept, deprecateConcept, loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	const PAGE_SIZE = 200;

	/** `undefined` while loading, `null` when no namespace is marked yet. */
	let core = $state<string | null | undefined>(undefined);
	let concepts = $state<Concept[]>([]);
	let schemes = $state<ConceptScheme[]>([]);
	let externals = $state<FetchedExternalVocabulary[]>([]);
	let hasMore = $state(false);
	let error = $state<string | null>(null);
	let selectedIri = $state<string | null>(null);
	/** `null` = closed, `'new'` = adding, otherwise the concept being edited. */
	let editing = $state<Concept | 'new' | null>(null);
	let deprecating = $state<Concept | null>(null);
	let promoting = $state<Concept | null>(null);
	/** `null` = closed; otherwise the proposals of the open backfill review. */
	let backfill = $state<{ proposals: BackfillProposal[]; concepts: Concept[] } | null>(null);
	let confirmingDelete = $state<{ iri: string; linkedClasses: string[]; narrower: string[] } | null>(null);
	let newScheme = $state('');
	/** Why the concept or relation is being changed; written to the change log with the change. */
	let rationale = $state('');
	let relationRationale = $state('');
	let scopeSchemeIri = $state('');

	/** Gates run over the concepts already loaded: no query of their own. */
	const findings = $derived(runVocabularyGates(concepts));
	const selectedFindings = $derived(findings.filter((f) => f.elementIri === selectedIri));
	const selected = $derived(concepts.find((c) => c.iri === selectedIri) ?? null);
	const scopeScheme = $derived(schemes.find((s) => s.iri === scopeSchemeIri) ?? null);
	const schemeName = $derived(new Map(schemes.map((s) => [s.iri, s.name])));
	const labelOf = (iri: string) => {
		const c = concepts.find((x) => x.iri === iri);
		return c ? conceptTitle(c) : (iri.split(/[#/]/).pop() ?? iri);
	};

	async function load(more = false) {
		error = null;
		try {
			if (!more) {
				await namespaceStore.refresh();
				core = await sparqlConnector.fetchVocabularyNamespace();
			}
			if (!core) return;
			const [loadedSchemes, loaded, loadedExternals] = await Promise.all([
				sparqlConnector.fetchConceptSchemes(core),
				sparqlConnector.fetchConcepts(core, { limit: PAGE_SIZE, offset: more ? concepts.length : 0 }),
				more ? Promise.resolve(externals) : sparqlConnector.fetchExternalVocabularies()
			]);
			schemes = loadedSchemes;
			externals = loadedExternals;
			concepts = more ? [...concepts, ...loaded.concepts] : loaded.concepts;
			hasMore = loaded.hasMore;
			if (!scopeSchemeIri && schemes[0]) scopeSchemeIri = schemes[0].iri;
			// A link from the Gate report: `/vocabulary?concept=<iri>`.
			const wanted = page.url.searchParams.get('concept');
			if (!more && wanted && !selectedIri && concepts.some((c) => c.iri === wanted)) selectedIri = wanted;
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
				confirmingDelete = { iri: concept.iri, linkedClasses: result.linkedClasses, narrower: result.narrower };
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

	async function addScheme(event: SubmitEvent) {
		event.preventDefault();
		if (!core || !newScheme.trim()) return;
		await act(async () => {
			scopeSchemeIri = await sparqlConnector.insertConceptScheme(core!, { name: newScheme, description: '' });
			newScheme = '';
		});
	}

	async function saveScope(scope: SchemeScope) {
		if (!core || !scopeScheme) return;
		await sparqlConnector.updateConceptSchemeScope(core, scopeScheme.iri, scope);
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
				<button type="button" onclick={openBackfill} data-testid="backfill-concepts">Create concepts for unlinked classes</button>
				<button type="button" onclick={() => (editing = 'new')} data-testid="add-concept">Add concept</button>
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
		<div class="columns">
			<section class="list">
				<ConceptList {concepts} {schemes} {selectedIri} {findings} onSelect={(iri) => (selectedIri = iri)} />
				{#if hasMore}
					<button type="button" onclick={() => load(true)}>Load more</button>
				{/if}
			</section>

			<section class="detail" aria-label="Concept">
				{#if selected}
					<h2>{conceptTitle(selected)}</h2>
					<p><a href={reviewConceptUrl(selected.iri)} data-testid="review-link">Read-only page to share</a></p>
					<p class="status-line">
						<span class="badge status-{selected.status}">{selected.status}</span>
						{#if selected.schemeIri}in {schemeName.get(selected.schemeIri) ?? selected.schemeIri}{/if}
						{#if selected.topConcept}<span class="hint">(top concept)</span>{/if}
					</p>
					<dl>
						<dt>Definition <code>skos:definition</code></dt>
						<dd>{selected.definition || '—'}</dd>
						{#if selected.scopeNote}
							<dt>Scope note <code>skos:scopeNote</code></dt>
							<dd>{selected.scopeNote}</dd>
						{/if}
						<dt>Preferred <code>skos:prefLabel</code></dt>
						<dd>{selected.prefLabels.map((l) => (l.lang ? `${l.text} (${l.lang})` : l.text)).join(', ')}</dd>
						{#if selected.altLabels.length}
							<dt>Alternative <code>skos:altLabel</code></dt>
							<dd>{selected.altLabels.map((l) => l.text).join(', ')}</dd>
						{/if}
						{#if selected.hiddenLabels.length}
							<dt>Hidden <code>skos:hiddenLabel</code></dt>
							<dd>{selected.hiddenLabels.map((l) => l.text).join(', ')}</dd>
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
					{#if selectedFindings.length}
						<ul class="findings-list" aria-label="Gate findings">
							{#each selectedFindings as f (f.gateId)}
								<li class:info={f.severity === 'info'}>{f.message}</li>
							{/each}
						</ul>
					{/if}
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
						<button type="button" class="danger" onclick={() => remove(selected)}>Delete</button>
					</div>
					{#if confirmingDelete && confirmingDelete.iri === selected.iri}
						<div class="warning" role="alert">
							<p>
								This concept is still in use:
								{confirmingDelete.linkedClasses.length} linked class{confirmingDelete.linkedClasses.length === 1 ? '' : 'es'},
								{confirmingDelete.narrower.length} narrower concept{confirmingDelete.narrower.length === 1 ? '' : 's'}.
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

		<section class="schemes">
			<h2>Schemes</h2>
			<form class="inline" onsubmit={addScheme}>
				<label>
					New scheme
					<input type="text" bind:value={newScheme} placeholder="e.g. Business glossary" />
				</label>
				<button type="submit" disabled={!newScheme.trim()}>Add scheme</button>
			</form>
			{#if schemes.length}
				<label>
					Scope of
					<select bind:value={scopeSchemeIri}>
						{#each schemes as scheme (scheme.iri)}
							<option value={scheme.iri}>{scheme.name}</option>
						{/each}
					</select>
				</label>
				{#if scopeScheme}
					{#key scopeScheme.iri}
						<SchemeScopeForm scheme={scopeScheme} onSave={saveScope} />
					{/key}
				{/if}
			{:else}
				<p class="empty">No scheme yet. A scheme groups concepts and records why the vocabulary exists.</p>
			{/if}
		</section>
	{/if}
</div>

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
			bind:rationale
		/>
	{/if}
</Modal>

<Modal isOpen={promoting !== null} title="Promote to class" onClose={() => (promoting = null)} maxWidth="520px" dismissible={false}>
	{#if promoting}
		<PromoteConceptDialog
			conceptTitle={conceptTitle(promoting)}
			namespaces={namespaceStore.namespaces}
			onConfirm={confirmPromote}
			onCancel={() => (promoting = null)}
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

	.status-line {
		margin: 0;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.actions {
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

	.inline {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input,
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.schemes {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 36rem;
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

	.danger {
		color: var(--color-error);
	}
</style>
