<script lang="ts">
	/** One namespace's six pipeline stages with counts, findings and links (ontology-pipeline STORY-320). */
	import { STAGE_IDS, type NamespaceSummary, type StageId } from '#lib/services/pipeline-summary.js';
	import { STAGE_GUIDES } from '#lib/services/pipeline-guides.js';

	interface Props {
		summary: NamespaceSummary;
		/** Stages whose data is still loading: shown as "Loading…" instead of counts or "Not started". */
		pending?: StageId[];
		/** Opens the documentation on a guide. Left out on the read-only review page, which then shows no guide links. */
		onOpenGuide?: (sectionId: string) => void;
	}

	let { summary, pending = [], onOpenGuide }: Props = $props();

	const LABEL: Record<StageId, string> = {
		vocabulary: 'Vocabulary',
		taxonomy: 'Taxonomy',
		thesaurus: 'Thesaurus',
		ontology: 'Ontology',
		validation: 'Validation',
		application: 'Application'
	};

	// Keeps the strip in the method's order whatever order the summary arrives in.
	const stages = $derived(
		STAGE_IDS.map((id) => summary.stages.find((s) => s.stage === id)).filter((s) => s !== undefined)
	);

	function findingsText(warnings: number, infos: number): string {
		const parts: string[] = [];
		if (warnings > 0) parts.push(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`);
		if (infos > 0) parts.push(`${infos} info`);
		return parts.join(', ');
	}
</script>

<section class="strip">
	<h3>{summary.prefix}</h3>
	<ol>
		{#each stages as s (s.stage)}
			<li class:started={s.status === 'in-progress'}>
				<h4>{LABEL[s.stage]}</h4>
				{#if onOpenGuide}
					<div class="guides">
						{#each STAGE_GUIDES[s.stage] as guide, i (guide.sectionId)}
							<button
								type="button"
								class="guide-link"
								aria-label={i === 0 ? `${guide.label}: ${LABEL[s.stage]}` : guide.label}
								onclick={() => onOpenGuide(guide.sectionId)}
							>
								{guide.label}
							</button>
						{/each}
					</div>
				{/if}
				{#if pending.includes(s.stage)}
					<span class="not-started" data-testid="stage-loading">Loading…</span>
				{:else if s.status === 'not-started'}
					<span class="not-started">Not started</span>
				{/if}
				{#each pending.includes(s.stage) ? [] : s.stats as stat (stat.label)}
					<div class="stat">
						{#if stat.href}
							<a href={stat.href}>{stat.label}: <strong>{stat.value}</strong></a>
						{:else}
							{stat.label}: <strong>{stat.value}</strong>
						{/if}
					</div>
				{/each}
				{#if !pending.includes(s.stage) && s.warnings + s.infos > 0}
					<div class="findings">{findingsText(s.warnings, s.infos)}</div>
				{/if}
			</li>
		{/each}
	</ol>
</section>

<style>
	.strip {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	h3 {
		margin: 0;
		font-size: 1rem;
	}
	ol {
		display: grid;
		grid-template-columns: repeat(6, minmax(8rem, 1fr));
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-x: auto;
	}
	li {
		padding: 0.5rem 0.6rem;
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		font-size: 0.85rem;
		min-width: 8rem;
	}
	li.started {
		border-style: solid;
	}
	h4 {
		margin: 0 0 0.25rem;
		font-size: 0.9rem;
	}
	.not-started {
		color: var(--color-text-muted);
	}
	.guides {
		display: flex;
		flex-wrap: wrap;
		gap: 0.1rem 0.6rem;
		margin-bottom: 0.25rem;
	}
	.guide-link {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-accent);
		font-size: 0.8rem;
		cursor: pointer;
	}
	.guide-link:hover {
		text-decoration: underline;
	}
	.findings {
		color: var(--color-error);
		font-size: 0.8rem;
	}
</style>
