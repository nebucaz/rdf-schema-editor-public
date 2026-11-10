<script lang="ts">
	/** The `skos:broader` outline of one scheme next to a read-only `rdfs:subClassOf` tree (ontology-pipeline
	 *  STORY-328). Dropping a concept on another asks the is-a question, a review prompt and not a rule, and only
	 *  then reports the single change; the page writes it. Cycles and top-concept moves are refused up front. */
	import type { GateFinding } from '#lib/services/gates/types.js';
	import { conceptTitle, type Concept, type ConceptScheme } from '#lib/services/skos-concept.js';
	import {
		buildTaxonomy,
		validateReparent,
		type TaxonomyMarker,
		type TaxonomyNode
	} from '#lib/services/taxonomy-tree.js';

	interface Props {
		concepts: Concept[];
		schemes: ConceptScheme[];
		/** `rdfs:subClassOf` tree of the selected namespace, read-only. */
		classTree: TaxonomyNode[];
		/** Taxonomy gate findings; each shows under the concept or class it is about. */
		findings?: GateFinding[];
		/** `toIri` is null when the concept is detached from `fromIri` and left without a broader concept. */
		onMove: (childIri: string, fromIri: string | null, toIri: string | null) => Promise<void>;
		onTopChange: (iri: string, top: boolean) => Promise<void>;
	}

	let { concepts, schemes, classTree, findings = [], onMove, onTopChange }: Props = $props();

	const about = (iri: string) => findings.filter((f) => f.elementIri === iri);

	const MARKER_TEXT: Record<TaxonomyMarker, string> = {
		orphan: 'orphan',
		cycle: 'cycle',
		'multiple-parents': 'multiple parents',
		'top-with-broader': 'top concept with a broader concept'
	};

	let chosenScheme = $state('');
	let dragging = $state<{ iri: string; fromIri: string | null } | null>(null);
	let pending = $state<{ iri: string; fromIri: string | null; toIri: string | null } | null>(null);
	let message = $state<string | null>(null);
	let busy = $state(false);

	/** Falls back to the first scheme, then to the concepts without one. */
	const schemeIri = $derived(chosenScheme || schemes[0]?.iri || '');
	const tree = $derived(buildTaxonomy(concepts, schemeIri));
	const byIri = $derived(new Map(concepts.map((c) => [c.iri, c])));
	const title = (iri: string) => {
		const c = byIri.get(iri);
		return c ? conceptTitle(c) : iri;
	};

	function start(iri: string, fromIri: string | null) {
		dragging = { iri, fromIri };
		message = null;
	}

	function dropOn(targetIri: string | null) {
		const drag = dragging;
		dragging = null;
		if (!drag) return;
		if (targetIri === null) {
			pending = { ...drag, toIri: null };
			message = null;
			return;
		}
		if (targetIri === drag.fromIri) return;
		const problem = validateReparent(concepts, drag.iri, targetIri);
		if (problem) {
			message = problem;
			pending = null;
			return;
		}
		message = null;
		pending = { ...drag, toIri: targetIri };
	}

	async function run(action: () => Promise<void>) {
		busy = true;
		message = null;
		try {
			await action();
		} catch (e) {
			message = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	async function confirm() {
		const move = pending;
		if (!move) return;
		await run(() => onMove(move.iri, move.fromIri, move.toIri));
		pending = null;
	}
</script>

{#snippet branch(nodes: TaxonomyNode[], parentIri: string | null)}
	<ul class="tree">
		{#each nodes as node (`${parentIri}|${node.iri}`)}
			{@const concept = byIri.get(node.iri)}
			<li>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="row"
					draggable="true"
					style:padding-left="{node.depth * 1.25 + 0.4}rem"
					ondragstart={() => start(node.iri, parentIri)}
					ondragover={(e) => e.preventDefault()}
					ondrop={(e) => {
						e.preventDefault();
						e.stopPropagation();
						dropOn(node.iri);
					}}
				>
					<span class="depth" title="Depth {node.depth}">L{node.depth}</span>
					<span class="label">{node.label}</span>
					{#each node.markers as marker (marker)}
						<span class="marker marker-{marker}">{MARKER_TEXT[marker]}</span>
					{/each}
					{#if concept}
						<label class="top">
							<input
								type="checkbox"
								checked={concept.topConcept}
								disabled={busy || !concept.schemeIri}
								aria-label="Top concept: {node.label}"
								onchange={(e) => run(() => onTopChange(node.iri, e.currentTarget.checked))}
							/>
							top
						</label>
					{/if}
				</div>
				{#each about(node.iri) as f (f.gateId + f.message)}
					<p class="finding" class:info={f.severity === 'info'} style:margin-left="{node.depth * 1.25 + 0.4}rem">{f.message}</p>
				{/each}
				{#if node.children.length}
					{@render branch(node.children, node.iri)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet readOnlyBranch(nodes: TaxonomyNode[])}
	<ul class="tree">
		{#each nodes as node (node.iri)}
			<li>
				<div class="row" style:padding-left="{node.depth * 1.25 + 0.4}rem">
					<span class="depth">L{node.depth}</span>
					<span class="label">{node.label}</span>
					{#each node.markers as marker (marker)}
						<span class="marker marker-{marker}">{MARKER_TEXT[marker]}</span>
					{/each}
				</div>
				{#each about(node.iri) as f (f.gateId + f.message)}
					<p class="finding" class:info={f.severity === 'info'} style:margin-left="{node.depth * 1.25 + 0.4}rem">{f.message}</p>
				{/each}
				{#if node.children.length}
					{@render readOnlyBranch(node.children)}
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<div class="outline">
	<section aria-label="Concept taxonomy">
		<h2>Concepts (skos:broader)</h2>
		<label class="scheme">
			Scheme
			<select value={schemeIri} onchange={(e) => (chosenScheme = e.currentTarget.value)}>
				{#each schemes as scheme (scheme.iri)}
					<option value={scheme.iri}>{scheme.name}</option>
				{/each}
				<option value="">(no scheme)</option>
			</select>
		</label>

		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}

		{#if pending}
			<div class="confirm" role="group" aria-label="Confirm move">
				{#if pending.toIri}
					<p>Is every {title(pending.iri)} a kind of {title(pending.toIri)}?</p>
					<p class="hint">Check it before you move it: a broader concept must always be the more general one.</p>
				{:else}
					<p>Detach {title(pending.iri)} from {pending.fromIri ? title(pending.fromIri) : 'its parent'}?</p>
				{/if}
				<div class="actions">
					<button type="button" class="secondary" onclick={() => (pending = null)} disabled={busy}>Cancel</button>
					<button type="button" class="primary" onclick={confirm} disabled={busy}>{pending.toIri ? 'Move' : 'Detach'}</button>
				</div>
			</div>
		{/if}

		{#if tree.length === 0}
			<p class="empty">No concepts in this scheme.</p>
		{:else}
			{@render branch(tree, null)}
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="detach"
			data-testid="detach-zone"
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				dropOn(null);
			}}
		>
			Drop here to remove the broader concept
		</div>
	</section>

	<section aria-label="Class hierarchy" data-testid="class-tree">
		<h2>Classes (rdfs:subClassOf)</h2>
		{#if classTree.length === 0}
			<p class="empty">No classes in this namespace.</p>
		{:else}
			{@render readOnlyBranch(classTree)}
		{/if}
	</section>
</div>

<style>
	.outline {
		display: grid;
		grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
		gap: 1.5rem;
	}

	@media (max-width: 800px) {
		.outline {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	h2 {
		font-size: 1rem;
		margin: 0 0 0.5rem;
	}

	.scheme {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin-bottom: 0.75rem;
		max-width: 20rem;
	}

	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0.3rem;
		padding-bottom: 0.3rem;
		border-bottom: 1px solid var(--color-border);
		font-size: 0.92rem;
	}

	.row[draggable='true'] {
		cursor: grab;
	}

	.row[draggable='true']:hover {
		background: var(--color-hover);
	}

	.depth {
		font-size: 0.7rem;
		color: var(--color-text-muted);
	}

	.label {
		flex: 1;
	}

	.marker {
		font-size: 0.72rem;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		padding: 0 0.4rem;
		color: var(--color-text-muted);
	}

	.marker-cycle,
	.marker-top-with-broader {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.top {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	.detach {
		margin-top: 0.75rem;
		padding: 0.6rem;
		border: 1px dashed var(--color-border);
		border-radius: 6px;
		font-size: 0.8rem;
		color: var(--color-text-muted);
		text-align: center;
	}

	.confirm {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.finding {
		margin: 0.15rem 0 0.15rem;
		font-size: 0.8rem;
		color: var(--color-error);
	}

	.finding.info {
		color: var(--color-text-muted);
	}

	.hint,
	.empty {
		color: var(--color-text-muted);
		font-size: 0.85rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}

	button.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
</style>
