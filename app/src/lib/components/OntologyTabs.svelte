<script lang="ts">
	/** The tab strip of the Ontology page (spec/ontology-dashboard STORY-466). The page owns the selected tab (it lives
	 *  in the URL as `?tab=`), so switching never reloads the schema. */
	import { ONTOLOGY_TABS, type OntologyTab } from '#lib/services/ontology-tabs.js';

	interface Props {
		tab: OntologyTab;
		onSelect: (tab: OntologyTab) => void;
	}

	let { tab, onSelect }: Props = $props();

	const LABELS: Record<OntologyTab, string> = { overview: 'Overview', checks: 'Model checks' };

	function onKey(event: KeyboardEvent, current: OntologyTab) {
		const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
		if (!step) return;
		event.preventDefault();
		const i = ONTOLOGY_TABS.indexOf(current);
		onSelect(ONTOLOGY_TABS[(i + step + ONTOLOGY_TABS.length) % ONTOLOGY_TABS.length]);
	}
</script>

<div class="tabs" role="tablist" aria-label="Ontology views">
	{#each ONTOLOGY_TABS as id (id)}
		<button
			type="button"
			role="tab"
			aria-selected={tab === id}
			tabindex={tab === id ? 0 : -1}
			class:active={tab === id}
			data-testid={`ontology-tab-${id}`}
			onclick={() => onSelect(id)}
			onkeydown={(e) => onKey(e, id)}>{LABELS[id]}</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}
	.tabs button {
		padding: 0.4rem 1rem;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}
	.tabs button:hover {
		color: var(--color-text);
	}
	.tabs button.active {
		border-color: var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-accent);
		font-weight: 600;
	}
</style>
