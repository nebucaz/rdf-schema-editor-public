<script lang="ts">
	/** The Model checks tile (spec/ontology-dashboard STORY-472): the total, the severities and the stages with problems.
	 *  Each count links to the Model checks tab with that filter applied; the list itself lives there. */
	import type { ChecksTileModel } from '#lib/services/ontology-dashboard-model.js';

	interface Props {
		model: ChecksTileModel;
	}

	let { model }: Props = $props();
</script>

{#if model.total === 0}
	<p data-testid="checks-none">No model problems.</p>
{:else}
	<h3>By severity</h3>
	<ul aria-label="Problems by severity">
		{#each model.severities as s (s.severity)}
			<li><a href={s.href}><span>{s.label}</span><strong>{s.count}</strong></a></li>
		{/each}
	</ul>
	<h3>By stage</h3>
	<ul aria-label="Problems by stage">
		{#each model.stages as s (s.stage)}
			<li><a href={s.href}><span>{s.label}</span><strong>{s.count}</strong></a></li>
		{/each}
	</ul>
	<p class="total" data-testid="checks-total">
		<a href={model.allHref}><span>Total</span><strong>{model.total} {model.total === 1 ? 'problem' : 'problems'}</strong></a>
	</p>
{/if}

<style>
	p {
		margin: 0;
	}
	h3 {
		margin: 0.5rem 0 0.2rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-muted);
	}
	h3:first-child {
		margin-top: 0;
	}
	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}
	a {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.15rem 0;
		color: inherit;
		text-decoration: none;
	}
	li + li a {
		border-top: 1px solid var(--color-border);
	}
	a:hover span {
		text-decoration: underline;
		color: var(--color-accent-hover);
	}
	.total {
		margin-top: 0.5rem;
		padding-top: 0.3rem;
		border-top: 2px solid var(--color-border);
		font-size: 0.95rem;
	}
</style>
