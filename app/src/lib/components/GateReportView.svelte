<script lang="ts">
	/**
	 * Gate report (ontology-pipeline STORY-319): findings of the quality gates, grouped by pipeline stage.
	 * Read-only and advisory: nothing here, or anywhere, is disabled by a finding. The schema comes from the
	 * shared `schemaStore` copy, so opening the report costs no request of its own once it is loaded.
	 */
	import { onMount } from 'svelte';
	import { runGates, PIPELINE_STAGES, type GateFinding, type GateFix, type PipelineStage } from '#lib/services/gates/index.js';
	import { gateFindingLink } from '#lib/services/gates/links.js';
	import type { Governance } from '#lib/services/governance.js';
	import type { Concept } from '#lib/services/skos-concept.js';
	import { sparqlConnector, type FetchedSchema } from '#lib/services/sparql-connector.js';
	import { loadAllConcepts } from '#lib/services/vocabulary-actions.js';
	import { schemaStore } from '#lib/stores/schema-store.js';

	interface Props {
		/** Replaceable for tests; defaults to the shared schema including individuals. */
		load?: () => Promise<FetchedSchema>;
		/** The core vocabulary's concepts for the vocabulary gates; `null` when there is no vocabulary. */
		loadConcepts?: () => Promise<Concept[] | null>;
		/** The core namespace's governance settings for the governance gate; `null` when there is no core namespace. */
		loadGovernance?: () => Promise<(Governance & { namespaceIri: string }) | null>;
		/** Applies a finding's fix (relinking a class to the replacement concept). */
		onRetarget?: (fix: GateFix) => Promise<void>;
	}

	let {
		load = () => schemaStore.ensureLoaded('full'),
		loadConcepts = () => loadAllConcepts(sparqlConnector),
		loadGovernance = async () => {
			const core = await sparqlConnector.fetchVocabularyNamespace();
			return core ? { namespaceIri: core, ...(await sparqlConnector.fetchNamespaceGovernance(core)) } : null;
		},
		onRetarget = async (fix) => {
			await sparqlConnector.setClassConcept(fix.classIri, fix.conceptIri, fix.namespaceBaseIri);
			schemaStore.invalidate();
		}
	}: Props = $props();

	const STAGE_LABEL: Record<PipelineStage, string> = {
		vocabulary: 'Vocabulary',
		metadata: 'Metadata',
		taxonomy: 'Taxonomy',
		thesaurus: 'Thesaurus',
		ontology: 'Ontology',
		knowledgeGraph: 'Knowledge graph',
		governance: 'Governance'
	};

	let schema = $state<FetchedSchema | null>(null);
	let error = $state<string | null>(null);
	/** `undefined` when there is no vocabulary (or it could not be read): the vocabulary and link gates then stay silent. */
	let concepts = $state<Concept[] | undefined>(undefined);
	let vocabularyError = $state(false);
	let governance = $state<(Governance & { namespaceIri: string }) | null>(null);
	let retargetError = $state<string | null>(null);
	let loading = $state(true);

	const findings = $derived(schema ? runGates(schema, { concepts, governance }) : []);
	const groups = $derived(
		PIPELINE_STAGES.map((stage) => ({
			stage,
			items: findings
				.filter((f) => f.stage === stage)
				// Warnings first; the rest keeps the gates' own order.
				.sort((a, b) => Number(b.severity === 'warning') - Number(a.severity === 'warning'))
		})).filter((g) => g.items.length > 0)
	);

	function link(finding: GateFinding): string | null {
		return schema ? gateFindingLink(finding, schema) : null;
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
			// The model is reported even when the vocabulary cannot be read.
			const [loadedSchema, loadedConcepts, loadedGovernance] = await Promise.all([
				load(),
				loadConcepts().catch(() => {
					vocabularyError = true;
					return null;
				}),
				loadGovernance().catch(() => null)
			]);
			schema = loadedSchema;
			governance = loadedGovernance;
			concepts = loadedConcepts ?? undefined;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load the schema';
		} finally {
			loading = false;
		}
	}

	onMount(refresh);
</script>

<div class="gate-report">
	{#if loading}
		<p>Loading…</p>
	{:else if error}
		<p class="error" role="alert">{error}</p>
	{:else}
		<p class="summary" data-testid="gate-summary">
			{findings.length === 1 ? '1 finding' : `${findings.length} findings`}.
			Gates only point things out; they never block a save.
		</p>
		{#if vocabularyError}
			<p class="error" role="status">The vocabulary could not be checked.</p>
		{/if}
		{#if retargetError}
			<p class="error" role="alert">{retargetError}</p>
		{/if}
		{#if groups.length === 0}
			<p>No findings.</p>
		{/if}
		{#each groups as group (group.stage)}
			<section>
				<h3>{STAGE_LABEL[group.stage]} <span class="count">({group.items.length})</span></h3>
				<ul>
					{#each group.items as f, i (`${f.gateId}|${f.elementIri}|${i}`)}
						<li>
							<span class="badge {f.severity}">{f.severity === 'warning' ? 'Warning' : 'Info'}</span>
							{f.message}
							{#if link(f)}
								<a href={link(f)}>Open</a>
							{/if}
							{#if f.fix}
								{@const fix = f.fix}
								<button type="button" class="fix" onclick={() => retarget(fix)}>Retarget to {fix.conceptLabel}</button>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	{/if}
</div>

<style>
	.gate-report {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
	}
	.count {
		color: var(--color-text-muted);
		font-weight: normal;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.badge {
		display: inline-block;
		min-width: 4rem;
		text-align: center;
		margin-right: 0.4rem;
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
