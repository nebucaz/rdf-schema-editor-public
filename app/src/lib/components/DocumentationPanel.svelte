<script lang="ts">
	import SvelteMarkdown from '@humanspeak/svelte-markdown';
	import { docSections, type DocCategory } from '$lib/content/docs/manifest';
	import { searchDocSections } from '$lib/content/docs/search';
	import { documentationStore } from '$lib/stores/documentation-store';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();

	/** Fixed display order for the table of contents (STORY-140) — matches STORY-134's five
	 *  category names, in the same order `research.md`'s inventory and `plan.md` list them. */
	const CATEGORY_ORDER: DocCategory[] = ['Canvas Nodes', 'Canvas Edges', 'Forms', 'Panels & Views', 'Toggles & Concepts'];

	const DEFAULT_WIDTH = 560;
	const MIN_WIDTH = 320;
	const MAX_WIDTH = 960;

	function clampWidth(width: number): number {
		return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
	}

	let panelWidth = $state(clampWidth(documentationStore.getPanelWidth() ?? DEFAULT_WIDTH));
	let resizing = $state(false);

	function startResize(event: PointerEvent) {
		event.preventDefault();
		resizing = true;
		const startX = event.clientX;
		const startWidth = panelWidth;

		function onPointerMove(moveEvent: PointerEvent) {
			// The handle sits on the panel's left edge and the panel is anchored to the right of the
			// screen, so dragging left (negative delta) must widen the panel.
			panelWidth = clampWidth(startWidth - (moveEvent.clientX - startX));
		}

		function stopResize() {
			resizing = false;
			documentationStore.setPanelWidth(panelWidth);
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', stopResize);
		}

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', stopResize);
	}

	let query = $state('');
	const hasQuery = $derived(query.trim().length > 0);
	const matchedSections = $derived(searchDocSections(docSections, query));

	const groupedSections = $derived(
		CATEGORY_ORDER.map((category) => ({
			category,
			sections: matchedSections.filter((s) => s.category === category).sort((a, b) => a.order - b.order)
		})).filter((group) => group.sections.length > 0)
	);

	/** STORY-142: restores the last-viewed section on open, but only if it still resolves to a real
	 *  manifest entry — a persisted id whose content was since renamed/removed falls back to the
	 *  same "no selection yet" TOC state a first-ever open shows, rather than erroring. */
	function initialSelectedId(): string {
		const lastId = documentationStore.getLastSectionId();
		return lastId && docSections.some((s) => s.id === lastId) ? lastId : '';
	}

	let selectedId = $state(initialSelectedId());

	function selectSection(id: string) {
		selectedId = id;
		documentationStore.setLastSectionId(id);
	}

	const selectedSection = $derived(docSections.find((s) => s.id === selectedId));
</script>

<div class="documentation-panel" class:resizing style:width="{panelWidth}px">
	<button
		type="button"
		class="resize-handle"
		aria-label="Resize documentation panel"
		onpointerdown={startResize}
	></button>
	<div class="panel-header">
		<h2>Documentation</h2>
		<button class="close-button" onclick={onClose} aria-label="Close">✕</button>
	</div>

	<div class="search-row">
		<input
			type="search"
			class="search-input"
			placeholder="Search documentation…"
			aria-label="Search documentation"
			bind:value={query}
		/>
	</div>

	<div class="panel-content">
		<nav class="toc" aria-label="Documentation sections">
			{#if hasQuery && matchedSections.length === 0}
				<p class="status toc-empty">No sections match "{query.trim()}".</p>
			{:else}
				{#each groupedSections as group (group.category)}
					<details class="toc-category" open>
						<summary class="toc-category-title">{group.category}</summary>
						<ul class="toc-list">
							{#each group.sections as section (section.id)}
								<li>
									<button
										type="button"
										class="toc-item"
										class:active={selectedId === section.id}
										aria-current={selectedId === section.id ? 'true' : undefined}
										onclick={() => selectSection(section.id)}
									>
										{section.title}
									</button>
								</li>
							{/each}
						</ul>
					</details>
				{/each}
			{/if}
		</nav>

		<div class="panel-body">
			{#if selectedSection}
				<SvelteMarkdown source={selectedSection.content} />
			{:else}
				<p class="status">Select a section from the table of contents.</p>
			{/if}
		</div>
	</div>
</div>

<style>
	.documentation-panel {
		position: fixed;
		top: var(--nav-height, 60px);
		right: 0;
		bottom: 0;
		max-width: 90vw;
		background: var(--color-bg-secondary);
		border-left: 1px solid var(--color-border);
		box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		z-index: 500;
	}

	.documentation-panel.resizing {
		user-select: none;
	}

	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -3px;
		width: 6px;
		padding: 0;
		border: none;
		background: transparent;
		cursor: col-resize;
		touch-action: none;
		z-index: 1;
	}

	.resize-handle:hover,
	.documentation-panel.resizing .resize-handle {
		background: var(--color-accent);
		opacity: 0.5;
	}

	.panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.panel-header h2 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.close-button {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
	}

	.close-button:hover {
		color: var(--color-text);
	}

	.search-row {
		padding: 0.6rem 1.25rem 0;
	}

	.search-input {
		width: 100%;
		padding: 0.35rem 0.6rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.8rem;
	}

	.panel-content {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.toc {
		width: 45%;
		max-width: 220px;
		flex-shrink: 0;
		overflow-y: auto;
		border-right: 1px solid var(--color-border);
		padding: 0.5rem;
	}

	.toc-category {
		margin-bottom: 0.25rem;
	}

	.toc-category-title {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-text-muted);
		padding: 0.4rem 0.5rem;
		cursor: pointer;
	}

	.toc-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.toc-item {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.35rem 0.5rem 0.35rem 1rem;
		border-radius: 6px;
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.toc-item:hover {
		background: var(--color-hover);
	}

	.toc-item.active {
		background: var(--color-accent);
		color: #fff;
	}

	.panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1.25rem;
		min-height: 0;
	}

	/* Rendered Markdown content comes from `@humanspeak/svelte-markdown`, which renders its own
	   h1/p/ul/etc. elements rather than ones defined in this component's template — `:global()` is
	   required for these selectors to reach past Svelte's scoping. */
	.panel-body :global(h1),
	.panel-body :global(h2),
	.panel-body :global(h3),
	.panel-body :global(h4) {
		margin-top: 1.75rem;
		margin-bottom: 0.85rem;
		line-height: 1.3;
	}

	.panel-body :global(h1:first-child),
	.panel-body :global(h2:first-child),
	.panel-body :global(h3:first-child),
	.panel-body :global(h4:first-child) {
		margin-top: 0;
	}

	.panel-body :global(p) {
		margin: 0.6rem 0;
	}

	.panel-body :global(ul),
	.panel-body :global(ol) {
		margin: 0.6rem 0;
		/* `outside` (the default) gives a proper hanging indent — wrapped lines of a list item align
		   under the first line's text, not back under the bullet. It needs an explicit `padding-left`
		   here because this app's `* { padding: 0 }` reset otherwise leaves no room for the marker,
		   pushing it left of the `ul`'s own edge (and so left of every paragraph's edge) instead of
		   flush with it. */
		padding-left: 1.25em;
		list-style-position: outside;
	}

	.panel-body :global(li) {
		margin: 0.25rem 0;
	}

	.status {
		color: var(--color-text-muted);
	}

	.toc-empty {
		padding: 0.4rem 0.5rem;
		font-size: 0.8rem;
	}
</style>
