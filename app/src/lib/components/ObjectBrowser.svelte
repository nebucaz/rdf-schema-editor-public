<script lang="ts">
	/**
	 * object-browser (STORY-254): a Finder-style multi-pane browser for choosing columns. Pane 1 lists the
	 * query's classes (or every class while there is no query); opening a class shows its properties
	 * (tickable), its links and, under "Referenced by", the links pointing at it. A link row — row or
	 * chevron — opens the target class' pane, so a column any number of relationships away is one drill-down.
	 *
	 * Props in, `onChange` out: the component keeps the ticked picks and the unticked existing columns and
	 * reports them; applying them to the model (`applyBrowserSelection`) is the host's job.
	 */
	import { tick } from 'svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { FetchedNamespace } from '$lib/services/sparql-connector';
	import type { QueryModel } from '$lib/services/query-model';
	import {
		DEEP_PATH_THRESHOLD,
		classPane,
		pathBreadcrumb,
		revealSteps,
		rootPane,
		searchBrowserTree,
		type BrowserSearchResult,
		type BrowsePath,
		type BrowseStep,
		type BrowserPick,
		type PaneColumn
	} from '$lib/services/query-object-browser';
	import { extractLocalName } from '$lib/utils/iri';
	import { propertyHints } from '$lib/utils/query-class-picker';

	interface Props {
		schema: BuilderSchema;
		namespaces: FetchedNamespace[];
		/** The query being extended; `null` = nothing started yet (pane 1 lists every class). */
		model: QueryModel | null;
		/** Opens with this group's class pane showing (`null` = the root). `undefined` = nothing open. */
		initialHopId?: string | null;
		/** Results shown by the search box (default 50). */
		searchLimit?: number;
		onChange: (selection: { picks: BrowserPick[]; removeColumnIds: string[] }) => void;
	}

	let { schema, namespaces, model, initialHopId, searchLimit = 50, onChange }: Props = $props();

	type Anchor = BrowsePath['anchor'];
	// The open path is read once as the dialog mounts; the host remounts the browser for a new target.
	let anchor = $state<Anchor | null>(
		(() => (model && initialHopId !== undefined ? { hopId: initialHopId } : null))()
	);
	let steps = $state<BrowseStep[]>(
		(() => (model && initialHopId !== undefined ? revealSteps(model, initialHopId) : []))()
	);
	let namespaceBaseIri = $state('');
	let picks = $state<BrowserPick[]>([]);
	let removed = $state<Set<string>>(new Set());
	/** The Selected columns list is collapsible so a long selection cannot push the dialog off screen. */
	let summaryOpen = $state(true);

	// Search (STORY-256): never touches the selection, only which panes are open.
	let query = $state('');
	let term = $state('');
	let before = $state<{ anchor: Anchor | null; steps: BrowseStep[] } | null>(null);
	let found = $state<{ paneIndex: number; propertyIri: string } | null>(null);
	$effect(() => {
		const q = query;
		const t = setTimeout(() => (term = q), q.trim() ? 150 : 0);
		return () => clearTimeout(t);
	});
	const search = $derived(
		term.trim()
			? searchBrowserTree(model, schema, term, { limit: searchLimit })
			: { results: [] as BrowserSearchResult[], more: false }
	);

	function onSearchInput(value: string) {
		query = value;
		if (!value.trim() && before) {
			anchor = before.anchor;
			steps = before.steps;
			before = null;
			found = null;
		}
	}

	function choose(r: BrowserSearchResult) {
		if (r.disabledReason !== null) return;
		before ??= { anchor, steps: [...steps] };
		openAnchor(r.path.anchor);
		steps = r.step ? [...r.path.steps, r.step] : [...r.path.steps];
		found = r.propertyIri ? { paneIndex: r.path.steps.length, propertyIri: r.propertyIri } : null;
		void tick().then(() => {
			const hit = panesEl?.querySelector<HTMLElement>('[data-found="true"] [data-nav]');
			if (hit) hit.focus();
			else focusPane(steps.length + 1);
		});
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && query) {
			e.preventDefault();
			e.stopPropagation();
			onSearchInput('');
		} else if (e.key === 'ArrowDown') {
			const firstResult = document.querySelector<HTMLElement>('[data-testid="browser-search-result"]');
			if (firstResult) {
				e.preventDefault();
				firstResult.focus();
			}
		}
	}

	function onResultKey(e: KeyboardEvent, r: BrowserSearchResult) {
		const all = [...document.querySelectorAll<HTMLElement>('[data-testid="browser-search-result"]')];
		const at = all.indexOf(e.currentTarget as HTMLElement);
		if (e.key === 'Enter') {
			e.preventDefault();
			choose(r);
		} else if (e.key === 'ArrowDown' && at < all.length - 1) {
			e.preventDefault();
			all[at + 1].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (at > 0) all[at - 1].focus();
			else document.querySelector<HTMLElement>('input[type="search"]')?.focus();
		}
	}

	const announce = $derived(
		anchor ? `${pathBreadcrumb(model, schema, { anchor, steps }).join(' › ')}, level ${steps.length}` : ''
	);

	// Keyboard (STORY-257): see the pattern note in the story. Rows are native buttons/checkboxes
	// (`data-nav`) with a roving tabindex, one tab stop per pane.
	let panesEl = $state<HTMLElement>();
	let activeIdx = $state<Record<number, number>>({});
	const tabindexOf = (pane: number, idx: number) => ((activeIdx[pane] ?? 0) === idx ? 0 : -1);
	const markActive = (pane: number, idx: number) => (activeIdx = { ...activeIdx, [pane]: idx });
	function dropActiveFrom(pane: number) {
		activeIdx = Object.fromEntries(Object.entries(activeIdx).filter(([k]) => Number(k) < pane));
	}
	const paneItems = (pane: number): HTMLElement[] => [
		...(panesEl?.querySelectorAll<HTMLElement>(`[data-pane="${pane}"] [data-nav]`) ?? [])
	];
	function focusPane(pane: number) {
		const items = paneItems(pane);
		(items.find((e) => e.tabIndex === 0) ?? items[0])?.focus();
	}
	async function activate(target: HTMLElement, pane: number) {
		if (target.getAttribute('aria-disabled') === 'true') return;
		target.click();
		await tick();
		focusPane(pane + 1);
	}
	function onPaneKey(e: KeyboardEvent, pane: number) {
		const target = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]');
		if (!target) return;
		const items = paneItems(pane);
		const at = items.indexOf(target);
		const isRow = target.dataset.nav === 'row';
		const go = (i: number) => {
			e.preventDefault();
			items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
		};
		switch (e.key) {
			case 'ArrowDown': return go(at + 1);
			case 'ArrowUp': return go(at - 1);
			case 'Home': return go(0);
			case 'End': return go(items.length - 1);
			case 'ArrowRight':
			case 'Enter':
				if (isRow) {
					e.preventDefault();
					void activate(target, pane);
				}
				return;
			case ' ':
				e.preventDefault();
				if (isRow) void activate(target, pane);
				else target.click();
				return;
			case 'ArrowLeft': {
				if (pane === 0) return;
				e.preventDefault();
				const prev = paneItems(pane - 1);
				(prev.find((x) => x.classList.contains('open')) ?? prev[0])?.focus();
			}
		}
	}

	const first = $derived(rootPane(model, schema, namespaces, namespaceBaseIri || null));
	const namespaceOptions = $derived(
		namespaces
			.filter((ns) => [...schema.classes.values()].some((c) => c.namespaceBaseIri === ns.baseIri))
			.sort((a, b) => a.prefix.localeCompare(b.prefix))
	);
	const classPanes = $derived(
		anchor
			? Array.from({ length: steps.length + 1 }, (_, k) => {
					const path: BrowsePath = { anchor: anchor!, steps: steps.slice(0, k) };
					return { path, pane: classPane(model, schema, path) };
				})
			: []
	);
	const deepest = $derived(classPanes.at(-1)?.pane);

	const sameAnchor = (a: Anchor | null, b: Anchor): boolean =>
		a !== null &&
		('hopId' in a && 'hopId' in b ? a.hopId === b.hopId : 'startClassIri' in a && 'startClassIri' in b && a.startClassIri === b.startClassIri);

	const pickKey = (path: BrowsePath, source: PaneColumn['source']) =>
		JSON.stringify([
			path.anchor,
			path.steps.map((s) => [s.relationshipIri, s.direction, s.targetClassIri]),
			source
		]);
	const pickIndex = (path: BrowsePath, source: PaneColumn['source']) =>
		picks.findIndex((p) => pickKey(p.path, p.source) === pickKey(path, source));

	// Selection markers: every object row shows how many selected columns live on it (first pane) or on it and
	// below it (link rows), so a selection in a sibling branch is never hidden behind an unopened pane.
	const stepKey = (st: { relationshipIri: string; direction: string; targetClassIri: string }) =>
		`${st.relationshipIri}|${st.direction}|${st.targetClassIri}`;
	function hopChain(hopId: string | null): string[] {
		const out: string[] = [];
		let id = hopId;
		while (id && model) {
			const h = model.hops.find((x) => x.id === id);
			if (!h) break;
			out.unshift(stepKey({ relationshipIri: h.propertyIri, direction: h.direction, targetClassIri: h.targetClassIri }));
			id = h.parentHopId;
		}
		return out;
	}
	const anchorChain = (a: Anchor): string[] => ('hopId' in a ? hopChain(a.hopId) : []);
	/** Absolute relationship chain (from the query root / start class) of every selected column. */
	const selectedChains = $derived([
		...(model?.columns ?? []).filter((c) => !removed.has(c.id)).map((c) => ({ start: null as string | null, chain: hopChain(c.hopId) })),
		...picks.map((p) => ({
			start: 'startClassIri' in p.path.anchor ? p.path.anchor.startClassIri : null,
			chain: [...anchorChain(p.path.anchor), ...p.path.steps.map(stepKey)]
		}))
	]);
	const startsWith = (chain: string[], prefix: string[]) => prefix.every((k, i) => chain[i] === k);
	/** Selected columns on the group at `chain` itself. */
	const selectedIn = (chain: string[]) =>
		selectedChains.filter((c) => c.chain.length === chain.length && startsWith(c.chain, chain)).length;
	/** Selected columns on the object at `chain` or anywhere below it. */
	const selectedUnder = (chain: string[]) => selectedChains.filter((c) => startsWith(c.chain, chain)).length;
	const selectedForStart = (iri: string) => picks.filter((p) => 'startClassIri' in p.path.anchor && p.path.anchor.startClassIri === iri).length;
	const linkChain = (k: number, step: BrowseStep) =>
		anchor ? [...anchorChain(anchor), ...steps.slice(0, k).map(stepKey), stepKey(step)] : [];
	const markerTitle = (n: number) => `${n} selected column${n === 1 ? '' : 's'}`;

	function emit() {
		onChange({ picks: picks.map((p) => ({ ...p })), removeColumnIds: [...removed] });
	}

	function openAnchor(next: Anchor) {
		// Picks of another start class would not fold into one query; a new start class starts over.
		if (!model && anchor && !sameAnchor(anchor, next) && picks.length > 0) {
			picks = [];
			emit();
		}
		anchor = next;
		steps = [];
		found = null;
		dropActiveFrom(1);
	}

	function openLink(paneIndex: number, step: BrowseStep) {
		steps = [...steps.slice(0, paneIndex), step];
		found = null;
		dropActiveFrom(paneIndex + 2);
	}

	function isTicked(path: BrowsePath, col: PaneColumn): boolean {
		return col.existingColumnId ? !removed.has(col.existingColumnId) : pickIndex(path, col.source) >= 0;
	}

	function toggle(path: BrowsePath, col: PaneColumn) {
		if (col.existingColumnId) {
			const next = new Set(removed);
			if (!next.delete(col.existingColumnId)) next.add(col.existingColumnId);
			removed = next;
		} else {
			const i = pickIndex(path, col.source);
			if (i >= 0) picks = picks.filter((_, j) => j !== i);
			else picks = [...picks, { path: { anchor: path.anchor, steps: [...path.steps] }, source: col.source, header: col.header }];
		}
		emit();
	}

	function removePick(i: number) {
		picks = picks.filter((_, j) => j !== i);
		emit();
	}

	function pickLabel(p: BrowserPick): string {
		const name =
			p.source === 'label' ? 'Label' : p.source === 'iri' ? 'IRI' : (propertyLabelOf(p) ?? extractLocalName(p.source.propertyIri));
		return [...pathBreadcrumb(model, schema, p.path), name].join(' › ');
	}
	function propertyLabelOf(p: BrowserPick): string | undefined {
		if (typeof p.source !== 'object') return undefined;
		const iri = p.source.propertyIri;
		const classIri = p.path.steps.at(-1)?.targetClassIri ?? paneAnchorClass(p.path.anchor);
		return schema.classes.get(classIri)?.properties.find((x) => x.iri === iri)?.label;
	}
	function paneAnchorClass(a: Anchor): string {
		if ('startClassIri' in a) return a.startClassIri;
		if (!model) return '';
		return a.hopId === null ? model.root.classIri : (model.hops.find((h) => h.id === a.hopId)?.targetClassIri ?? '');
	}
	/** Columns already in the query and not unticked: part of the selection the footer reports. */
	const keptColumns = $derived(
		(model?.columns ?? [])
			.filter((c) => !removed.has(c.id))
			.map((c) => ({
				id: c.id,
				label: [...pathBreadcrumb(model, schema, { anchor: { hopId: c.hopId }, steps: [] }), c.header].join(' › ')
			}))
	);
	const selectedCount = $derived(keptColumns.length + picks.length);
	function removeKept(id: string) {
		removed = new Set([...removed, id]);
		emit();
	}
	function removedLabel(id: string): string {
		const c = model?.columns.find((x) => x.id === id);
		return c ? c.header : id;
	}
</script>

<div class="browser" data-testid="object-browser">
	<div class="search">
		<input
			type="search"
			placeholder="Search classes and properties…"
			aria-label="Search classes and properties"
			value={query}
			oninput={(e) => onSearchInput(e.currentTarget.value)}
			onkeydown={onSearchKey}
		/>
		{#if term.trim()}
			<ul class="results" data-testid="browser-search-results">
				{#each search.results as r, i (i)}
					<li>
						<button
							type="button"
							class="row"
							data-testid="browser-search-result"
							aria-disabled={r.disabledReason !== null}
							onclick={() => choose(r)}
							onkeydown={(e) => onResultKey(e, r)}
						>
							<span class="name">{r.breadcrumb.join(' › ')}</span>
							<span class="meta">{r.kind === 'link' ? 'relationship' : 'property'}</span>
						</button>
						{#if r.disabledReason}<span class="meta">{r.disabledReason}</span>{/if}
					</li>
				{:else}
					<li class="meta">No matches</li>
				{/each}
			</ul>
			{#if search.more}
				<p class="meta" data-testid="browser-search-more">More matches exist — refine the search.</p>
			{/if}
		{/if}
	</div>
	<div class="sr-only" aria-live="polite" data-testid="browser-announce">{announce}</div>
	<div class="panes" bind:this={panesEl}>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<section
			class="pane"
			data-testid="browser-pane"
			data-pane="0"
			aria-label="Classes"
			onkeydown={(e) => onPaneKey(e, 0)}
		>
			{#if first.mode === 'start'}
				<select aria-label="Filter by namespace" bind:value={namespaceBaseIri}>
					<option value="">Any namespace</option>
					{#each namespaceOptions as ns (ns.baseIri)}
						<option value={ns.baseIri}>{ns.prefix}</option>
					{/each}
				</select>
				<ul>
					{#each first.options as o, j (o.iri)}
						<li>
							<button
								type="button"
								class="row"
								data-nav="row"
								tabindex={tabindexOf(0, j)}
								onfocus={() => markActive(0, j)}
								aria-expanded={sameAnchor(anchor, { startClassIri: o.iri })}
								class:open={sameAnchor(anchor, { startClassIri: o.iri })}
								onclick={() => openAnchor({ startClassIri: o.iri })}
							>
								<span class="name">{o.label}</span>
								{#if selectedForStart(o.iri) > 0}<span class="badge" data-testid="browser-selected-badge" title={markerTitle(selectedForStart(o.iri))}>{selectedForStart(o.iri)}</span><span class="sr-only">({markerTitle(selectedForStart(o.iri))})</span>{/if}
								<span class="chevron" data-testid="browser-chevron" aria-hidden="true">›</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<ul>
					{#each first.groups as g, j (g.hopId ?? 'root')}
						<li>
							<button
								type="button"
								class="row"
								data-nav="row"
								tabindex={tabindexOf(0, j)}
								onfocus={() => markActive(0, j)}
								aria-expanded={sameAnchor(anchor, { hopId: g.hopId })}
								class:open={sameAnchor(anchor, { hopId: g.hopId })}
								style:padding-left="{0.5 + g.depth * 0.75}rem"
								onclick={() => openAnchor({ hopId: g.hopId })}
							>
								<span class="name">{g.viaLabel ? `${g.viaLabel} ` : ''}{g.label}</span>
								{#if selectedIn(hopChain(g.hopId)) > 0}<span class="badge" data-testid="browser-selected-badge" title={markerTitle(selectedIn(hopChain(g.hopId)))}>{selectedIn(hopChain(g.hopId))}</span><span class="sr-only">({markerTitle(selectedIn(hopChain(g.hopId)))})</span>{/if}
								<span class="chevron" data-testid="browser-chevron" aria-hidden="true">›</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#each classPanes as { path, pane }, k (k)}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<section
				class="pane"
				data-testid="browser-pane"
				data-pane={k + 1}
				aria-label={`Properties of ${pane.label}`}
				onkeydown={(e) => onPaneKey(e, k + 1)}
			>
				<h3>{pane.label}</h3>
				<ul>
					{#each pane.columns as col, i (i)}
						{@const isFound = found?.paneIndex === k && typeof col.source === 'object' && col.source.propertyIri === found.propertyIri}
						<li data-testid="browser-property" data-found={isFound} class:found={isFound}>
							<label>
								<input
									type="checkbox"
									data-nav="check"
									tabindex={tabindexOf(k + 1, i)}
									onfocus={() => markActive(k + 1, i)}
									checked={isTicked(path, col)}
									onchange={() => toggle(path, col)}
								/>
								<span class="name">{col.name}</span>
							</label>
							{#if col.datatype}<span class="meta">{extractLocalName(col.datatype)}</span>{/if}
							{#if col.enumeration}<span class="tag" title="Restricted to a fixed list of values">enumeration</span>{/if}
							{#if typeof col.source === 'object'}
								{@const prop = schema.classes.get(pane.classIri)?.properties.find((p) => p.iri === (col.source as { propertyIri: string }).propertyIri)}
								{#if prop}{#each propertyHints(prop) as h (h)}<span class="tag">{h}</span>{/each}{/if}
							{/if}
						</li>
					{/each}
				</ul>
				{#snippet linkRows(links: typeof pane.links, offset: number)}
					<ul>
						{#each links as l, j (`${l.step.direction}|${l.step.relationshipIri}|${l.step.targetClassIri}`)}
							{@const idx = offset + j}
							{@const isOpen = steps[k] && steps[k].relationshipIri === l.step.relationshipIri && steps[k].direction === l.step.direction && steps[k].targetClassIri === l.step.targetClassIri}
							<li class:disabled={l.disabledReason !== null}>
								<button
									type="button"
									class="row"
									class:open={isOpen}
									data-nav="row"
									tabindex={tabindexOf(k + 1, idx)}
									onfocus={() => markActive(k + 1, idx)}
									aria-expanded={!!isOpen}
									aria-describedby={l.disabledReason ? `reason-${k}-${idx}` : undefined}
									aria-disabled={l.disabledReason !== null}
									onclick={() => l.disabledReason === null && openLink(k, l.step)}
								>
									<span class="name">{l.label} → {l.targetLabel}</span>
									{#if selectedUnder(linkChain(k, l.step)) > 0}<span class="badge" data-testid="browser-selected-badge" title={markerTitle(selectedUnder(linkChain(k, l.step)))}>{selectedUnder(linkChain(k, l.step))}</span><span class="sr-only">({markerTitle(selectedUnder(linkChain(k, l.step)))})</span>{/if}
									<span class="chevron" data-testid="browser-chevron" aria-hidden="true">›</span>
								</button>
								{#if l.disabledReason}<span class="meta" id={`reason-${k}-${idx}`}>{l.disabledReason}</span>{/if}
							</li>
						{/each}
					</ul>
				{/snippet}
				{#if pane.links.length > 0}
					<h4>Links</h4>
					{@render linkRows(pane.links, pane.columns.length)}
				{/if}
				{#if pane.inbound.length > 0}
					<h4>Referenced by</h4>
					{@render linkRows(pane.inbound, pane.columns.length + pane.links.length)}
				{/if}
			</section>
		{/each}
	</div>

	{#if deepest?.deep}
		<p class="warning" role="status" data-testid="browser-depth-warning">
			This path is more than {DEEP_PATH_THRESHOLD} relationships deep. Long paths make the query slower and the share link longer.
		</p>
	{/if}

	<section class="selected" data-testid="browser-selected" aria-label="Selected columns">
		<h3>
			<button
				type="button"
				class="toggle"
				data-testid="browser-selected-toggle"
				aria-expanded={summaryOpen}
				aria-controls="browser-selected-list"
				onclick={() => (summaryOpen = !summaryOpen)}
			>
				<span class="caret" aria-hidden="true">{summaryOpen ? '▾' : '▸'}</span>
				Selected columns ({selectedCount})
			</button>
		</h3>
		{#if selectedCount === 0}
			<p class="meta">Tick properties in the panes above.</p>
		{/if}
		<ul id="browser-selected-list" class="selected-list" hidden={!summaryOpen}>
			{#each keptColumns as c (c.id)}
				<li>
					<span class="crumb">{c.label}</span>
					<button type="button" aria-label={`Remove ${c.label}`} onclick={() => removeKept(c.id)}>Remove</button>
				</li>
			{/each}
			{#each picks as p, i (pickKey(p.path, p.source))}
				<li>
					<span class="crumb">{pickLabel(p)}</span>
					<button type="button" aria-label={`Remove ${pickLabel(p)}`} onclick={() => removePick(i)}>Remove</button>
				</li>
			{/each}
		</ul>
		{#if removed.size > 0}
			<p class="meta">Will be removed: {[...removed].map(removedLabel).join(', ')}</p>
		{/if}
	</section>
</div>

<style>
	.browser {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}
	.panes {
		display: flex;
		gap: 0;
		overflow-x: auto;
		border: 1px solid var(--color-group-border);
		border-radius: 6px;
		background: var(--color-group-bg);
	}
	.pane {
		flex: 0 0 15rem;
		max-height: 22rem;
		overflow-y: auto;
		padding: 0.5rem;
		border-right: 1px solid var(--color-group-border);
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.pane:last-child {
		border-right: none;
	}
	h3,
	h4 {
		margin: 0;
		font-size: 0.8rem;
	}
	h4 {
		margin-top: 0.5rem;
		opacity: 0.7;
		font-weight: 600;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}
	.row {
		display: flex;
		flex: 1;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		border-color: var(--color-border);
	}
	.row.open {
		background: var(--color-bg);
		border-color: var(--color-accent);
	}
	li.disabled .row {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.badge {
		margin-left: auto;
		min-width: 1.2rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--color-accent);
		color: var(--color-bg);
		font-size: 0.72rem;
		font-weight: 700;
		text-align: center;
	}
	.chevron {
		opacity: 0.6;
		font-weight: 700;
	}
	.meta,
	.tag {
		font-size: 0.72rem;
		opacity: 0.7;
	}
	.tag {
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0 0.25rem;
	}
	select {
		padding: 0.25rem 0.4rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.8rem;
	}
	.warning {
		margin: 0;
		padding: 0.4rem 0.6rem;
		border: 1px solid var(--color-border);
		border-left: 3px solid var(--color-accent-association, var(--color-accent));
		border-radius: 4px;
		font-size: 0.8rem;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.row:focus-visible,
	.pane input:focus-visible,
	.search input:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 1px;
	}
	.search {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.search input {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
	}
	.results {
		max-height: 10rem;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.25rem;
	}
	li.found {
		background: var(--color-bg);
		outline: 1px solid var(--color-accent);
		border-radius: 4px;
	}
	.search p {
		margin: 0;
	}
	.selected {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.selected-list {
		max-height: 9rem;
		overflow-y: auto;
	}
	.selected-list[hidden] {
		display: none;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.toggle:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	.selected li {
		justify-content: space-between;
		flex-wrap: nowrap;
		font-size: 0.85rem;
	}
	.selected p {
		margin: 0;
	}
</style>
