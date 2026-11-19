<script lang="ts">
	/**
	 * Model checks (ontology-dashboard STORY-462): the problems the quality gates find in the model, as one
	 * filterable list (stage, severity, search). Read-only and advisory: nothing here, or anywhere, is disabled
	 * by a problem. The schema comes from the shared `schemaStore` copy. The filter state is owned by the host
	 * (the page keeps it in the URL) and arrives as `query` / leaves through `onStateChange`.
	 */
	import { onMount } from 'svelte';
	import PagedListShell from '#lib/components/PagedListShell.svelte';
	import type { CompetencyQuestion, CompetencyQuestionRun } from '#lib/services/competency-question.js';
	import { runGates, PIPELINE_STAGES, type GateFinding, type GateFix } from '#lib/services/gates/index.js';
	import { gateFindingLink } from '#lib/services/gates/links.js';
	import type { Governance } from '#lib/services/governance.js';
	import {
		DEFAULT_MODEL_CHECKS_STATE,
		MODEL_CHECKS_PAGE_SIZE,
		STAGE_LABEL,
		filterProblems,
		pageOfProblems,
		patchModelChecksState,
		type ModelChecksState
	} from '#lib/services/model-checks-model.js';
	import type { SkosCollection } from '#lib/services/skos-collection.js';
	import type { Concept } from '#lib/services/skos-concept.js';
	import { sparqlConnector, type FetchedSchema } from '#lib/services/sparql-connector.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { parseDebtSettings, type DebtSettings } from '#lib/services/debt-settings.js';
	import { debtSettingsStore } from '#lib/stores/debt-settings-store.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	interface Props {
		query?: ModelChecksState;
		onStateChange?: (next: ModelChecksState) => void;
		/** Replaceable for tests; defaults to the shared schema including individuals. */
		load?: () => Promise<FetchedSchema>;
		/** The core vocabulary's concepts for the vocabulary gates; `null` when there is no vocabulary. */
		loadConcepts?: () => Promise<Concept[] | null>;
		/** The core namespace's governance settings for the governance gate; `null` when there is no core namespace. */
		loadGovernance?: () => Promise<(Governance & { namespaceIri: string }) | null>;
		/** The vocabulary's collections and schemes for the type and collection-member gates; empty when there is no vocabulary. */
		loadStructure?: () => Promise<{ collections: SkosCollection[]; schemes: { iri: string }[] }>;
		/** The competency questions and their runs, for the question gates; failing to load them leaves those gates silent. */
		loadQuestions?: () => Promise<{ questions: CompetencyQuestion[]; runs: CompetencyQuestionRun[] }>;
		/** Where the thresholds are kept; per browser by default. */
		settingsStore?: { get(): DebtSettings; set(settings: DebtSettings): void };
		/** The date ages are measured from; defaults to now. */
		now?: Date;
		/** Applies a problem's fix (relinking a class to the replacement concept). */
		onRetarget?: (fix: GateFix) => Promise<void>;
	}

	let {
		query = DEFAULT_MODEL_CHECKS_STATE,
		onStateChange = () => {},
		load = () => schemaStore.ensureLoaded('full'),
		loadConcepts = () => loadAllConcepts(sparqlConnector),
		loadStructure = async () => {
			const core = await sparqlConnector.fetchVocabularyNamespace();
			if (!core) return { collections: [], schemes: [] };
			const [collections, schemes] = await Promise.all([sparqlConnector.fetchCollections(core), sparqlConnector.fetchConceptSchemes(core)]);
			return { collections, schemes };
		},
		loadGovernance = async () => {
			const core = await sparqlConnector.fetchVocabularyNamespace();
			return core ? { namespaceIri: core, ...(await sparqlConnector.fetchNamespaceGovernance(core)) } : null;
		},
		loadQuestions = async () => {
			const [questions, runs] = await Promise.all([sparqlConnector.fetchCompetencyQuestions(), sparqlConnector.fetchCompetencyQuestionRuns()]);
			return { questions, runs };
		},
		settingsStore = debtSettingsStore,
		now,
		onRetarget = async (fix) => {
			await sparqlConnector.setClassConcept(fix.classIri, fix.conceptIri, fix.namespaceBaseIri);
			schemaStore.invalidate();
		}
	}: Props = $props();

	let schema = $state<FetchedSchema | null>(null);
	let error = $state<string | null>(null);
	/** `undefined` when there is no vocabulary (or it could not be read): the vocabulary and link gates then stay silent. */
	let concepts = $state<Concept[] | undefined>(undefined);
	let vocabularyError = $state(false);
	let structure = $state<{ collections: SkosCollection[]; schemes: { iri: string }[] }>({ collections: [], schemes: [] });
	let governance = $state<(Governance & { namespaceIri: string }) | null>(null);
	let questionData = $state<{ questions: CompetencyQuestion[]; runs: CompetencyQuestionRun[] } | null>(null);
	let retargetError = $state<string | null>(null);
	let loading = $state(true);
	let settings = $state<DebtSettings>(debtSettingsStore.get());
	// The injected store (tests) replaces the per-browser one once the component starts.
	onMount(() => {
		settings = settingsStore.get();
	});

	const all = $derived(
		schema
			? runGates(schema, {
					concepts,
					governance,
					...structure,
					...(questionData ?? {}),
					reviewPeriodMonths: settings.reviewPeriodMonths,
					staleAfterMonths: settings.staleAfterMonths,
					...(now ? { now } : {})
				})
			: []
	);
	const filtered = $derived(filterProblems(all, query));
	const shown = $derived(pageOfProblems(filtered, query.page));

	const THRESHOLDS = [
		{ key: 'reviewPeriodMonths', label: 'Question review period (months)' },
		{ key: 'staleAfterMonths', label: 'Concept stale after (months)' }
	] as const;

	/** A whole number of months from 1 to 120 is stored and the gates re-run; anything else puts the old value back. */
	function setThreshold(key: keyof DebtSettings, input: HTMLInputElement) {
		const text = input.value.trim();
		const next = parseDebtSettings(JSON.stringify({ ...settings, [key]: /^\d+$/.test(text) ? Number(text) : null }));
		if (next[key] === Number(text) && /^\d+$/.test(text)) {
			settings = next;
			settingsStore.set(next);
		} else {
			input.value = String(settings[key]);
		}
	}

	function link(problem: GateFinding): string | null {
		return schema ? gateFindingLink(problem, schema) : null;
	}

	async function retarget(fix: GateFix) {
		retargetError = null;
		try {
			await onRetarget(fix);
			await refresh();
		} catch (e) {
			retargetError = e instanceof Error ? e.message : 'Failed to retarget the link';
		}
	}

	async function refresh() {
		try {
			// The model is reported even when the vocabulary or the questions cannot be read.
			const [loadedSchema, loadedConcepts, loadedGovernance, loadedStructure, loadedQuestions] = await Promise.all([
				load(),
				loadConcepts().catch(() => {
					vocabularyError = true;
					return null;
				}),
				loadGovernance().catch(() => null),
				loadStructure().catch(() => ({ collections: [], schemes: [] })),
				loadQuestions().catch(() => null)
			]);
			structure = loadedStructure;
			schema = loadedSchema;
			governance = loadedGovernance;
			concepts = loadedConcepts ?? undefined;
			questionData = loadedQuestions;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the schema';
		} finally {
			loading = false;
		}
	}

	onMount(refresh);
</script>

<div class="model-checks">
	{#if loading}
		<p>Loading…</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
	{:else}
		<p class="summary" data-testid="model-checks-summary">
			{all.length === 1 ? '1 problem' : `${all.length} problems`}.
			Model checks only point things out; they never block a save.
		</p>
		<details class="thresholds">
			<summary>Thresholds</summary>
			{#each THRESHOLDS as t (t.key)}
				<label>
					{t.label}
					<input type="number" min="1" step="1" value={settings[t.key]} onchange={(e) => setThreshold(t.key, e.currentTarget)} />
				</label>
			{/each}
		</details>
		{#if vocabularyError}
			<p class="error" role="status">The vocabulary could not be checked.</p>
		{/if}
		{#if retargetError}
			<p class="error" role="alert">{retargetError}</p>
		{/if}
		{#if all.length === 0}
			<p>No model problems</p>
		{:else}
			<PagedListShell
				label="Model problems"
				total={filtered.length}
				pageSize={MODEL_CHECKS_PAGE_SIZE}
				page={query.page}
				search={query.q}
				onChange={(next) => onStateChange(patchModelChecksState(query, { q: next.search, page: next.page }))}
			>
				{#snippet filters()}
					<label>
						Stage
						<select value={query.stage} onchange={(e) => onStateChange(patchModelChecksState(query, { stage: e.currentTarget.value as ModelChecksState['stage'] }))}>
							<option value="">All stages</option>
							{#each PIPELINE_STAGES as stage (stage)}
								<option value={stage}>{STAGE_LABEL[stage]}</option>
							{/each}
						</select>
					</label>
					<label>
						Severity
						<select value={query.severity} onchange={(e) => onStateChange(patchModelChecksState(query, { severity: e.currentTarget.value as ModelChecksState['severity'] }))}>
							<option value="">All severities</option>
							<option value="warning">Warning</option>
							<option value="info">Info</option>
						</select>
					</label>
				{/snippet}
				<table>
					<thead>
						<tr><th>Stage</th><th>Severity</th><th>Problem</th><th></th></tr>
					</thead>
					<tbody>
						{#each shown as p, i (`${p.gateId}|${p.elementIri}|${i}`)}
							<tr>
								<td>{STAGE_LABEL[p.stage]}</td>
								<td><span class="badge {p.severity}">{p.severity === 'warning' ? 'Warning' : 'Info'}</span></td>
								<td>
									{p.message}
									{#if p.fix}
										{@const fix = p.fix}
										<button type="button" class="fix" onclick={() => retarget(fix)}>Retarget to {fix.conceptLabel}</button>
									{/if}
								</td>
								<td>{#if link(p)}<a href={link(p)}>Open</a>{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</PagedListShell>
		{/if}
	{/if}
</div>

<style>
	.model-checks {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.25rem 0.5rem;
		border-bottom: 1px solid var(--color-border);
		vertical-align: top;
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.9rem;
	}
	.thresholds label {
		margin-left: 1rem;
	}
	.thresholds input {
		width: 4.5rem;
	}
	.badge {
		display: inline-block;
		min-width: 4rem;
		text-align: center;
		padding: 0 0.4rem;
		border-radius: 4px;
		font-size: 0.8rem;
		border: 1px solid currentColor;
	}
	.badge.warning {
		color: var(--color-error);
	}
	.badge.info {
		color: var(--color-text-muted);
	}
	.fix {
		margin-left: 0.5rem;
		font-size: 0.8rem;
	}
	.summary,
	.error {
		margin: 0;
	}
	.error {
		color: var(--color-error);
	}
</style>
