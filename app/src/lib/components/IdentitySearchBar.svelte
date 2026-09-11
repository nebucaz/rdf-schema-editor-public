<script lang="ts">
	/**
	 * Search box + facet controls for the Identities route (STORY-118), ported from `semantic-crm`'s
	 * `SearchBar.svelte` and extended with the class/namespace/syncSource/syncStatus facets
	 * `research.md` §7 row 4 confirmed for v1. Every facet narrows `searchIndividuals`'s params when
	 * combined with the search box and with each other (an AND across all set fields, same as the
	 * connector method itself).
	 */
	import type { FetchedClass, FetchedNamespace } from '$lib/services/sparql-connector';

	export interface IdentityFacetValues {
		query: string;
		classIri: string | null;
		namespaceBaseIri: string | null;
		syncSource: string | null;
		syncStatus: string | null;
	}

	interface Props {
		values: IdentityFacetValues;
		classes: FetchedClass[];
		namespaces: FetchedNamespace[];
		isLoading?: boolean;
		onSearch: (values: IdentityFacetValues) => void;
		onClear: () => void;
	}

	let { values, classes, namespaces, isLoading = false, onSearch, onClear }: Props = $props();

	let query = $state(values.query);
	let classIri = $state(values.classIri ?? '');
	let namespaceBaseIri = $state(values.namespaceBaseIri ?? '');
	let syncSource = $state(values.syncSource ?? '');
	let syncStatus = $state(values.syncStatus ?? '');

	// Keep the local form state in sync when the URL changes underneath us (deep link, Back/Forward)
	// rather than only ever reading `values` once at mount.
	$effect(() => {
		query = values.query;
		classIri = values.classIri ?? '';
		namespaceBaseIri = values.namespaceBaseIri ?? '';
		syncSource = values.syncSource ?? '';
		syncStatus = values.syncStatus ?? '';
	});

	const sortedClasses = $derived(
		classes
			.filter((c) => !namespaceBaseIri || c.namespaceBaseIri === namespaceBaseIri)
			.sort((a, b) => a.label.localeCompare(b.label))
	);

	/** Namespace prefix lookup for `classOptionLabel` below — a class name alone ("Application")
	 *  can't disambiguate two same-named classes in different namespaces, so every option is
	 *  prefixed with its owning namespace's prefix (`prefix:ClassName`, matching the resource page's
	 *  type-badge chips) — sorting above still goes by the bare class label, not this prefixed
	 *  display string. */
	const namespacePrefixByBaseIri = $derived(
		new Map(namespaces.map((ns) => [ns.baseIri, ns.prefix]))
	);

	function classOptionLabel(c: FetchedClass): string {
		const prefix = namespacePrefixByBaseIri.get(c.namespaceBaseIri);
		// A space after the colon (unlike the resource page's `prefix:ClassName` chips) — `<option>`
		// text can't be partially bolded to set the class name apart, so the space is what carries
		// that separation here instead.
		return prefix ? `${prefix}: ${c.label}` : c.label;
	}

	function currentValues(): IdentityFacetValues {
		return {
			query: query.trim(),
			classIri: classIri || null,
			namespaceBaseIri: namespaceBaseIri || null,
			syncSource: syncSource || null,
			syncStatus: syncStatus || null
		};
	}

	function handleSubmit(event: Event) {
		event.preventDefault();
		if (!isLoading) onSearch(currentValues());
	}

	function handleFacetChange() {
		if (!isLoading) onSearch(currentValues());
	}

	/** Narrowing the namespace facet can drop the currently selected class out of `sortedClasses` —
	 *  clear it rather than leave a hidden, still-active filter that would AND with the namespace
	 *  filter in `searchIndividuals` and silently zero out results. */
	function handleNamespaceChange() {
		if (namespaceBaseIri && classIri) {
			const selected = classes.find((c) => c.iri === classIri);
			if (selected && selected.namespaceBaseIri !== namespaceBaseIri) {
				classIri = '';
			}
		}
		handleFacetChange();
	}

	function handleClear() {
		query = '';
		classIri = '';
		namespaceBaseIri = '';
		syncSource = '';
		syncStatus = '';
		onClear();
	}

	const hasAnyFilter = $derived(
		Boolean(query || classIri || namespaceBaseIri || syncSource || syncStatus)
	);
</script>

<form class="identity-search-bar" onsubmit={handleSubmit}>
	<div class="input-wrap">
		<input
			type="text"
			placeholder="Search identities by label…"
			bind:value={query}
			disabled={isLoading}
			aria-label="Search identities"
		/>
	</div>
	<button type="submit" disabled={isLoading}>
		{isLoading ? 'Searching…' : 'Search'}
	</button>

	<div class="facets">
		<select
			aria-label="Filter by class"
			bind:value={classIri}
			disabled={isLoading}
			onchange={handleFacetChange}
		>
			<option value="">Any class</option>
			{#each sortedClasses as c (c.iri)}
				<option value={c.iri}>{classOptionLabel(c)}</option>
			{/each}
		</select>

		<select
			aria-label="Filter by namespace"
			bind:value={namespaceBaseIri}
			disabled={isLoading}
			onchange={handleNamespaceChange}
		>
			<option value="">Any namespace</option>
			{#each namespaces as ns (ns.baseIri)}
				<option value={ns.baseIri}>{ns.prefix}</option>
			{/each}
		</select>

		<select
			aria-label="Filter by sync source"
			bind:value={syncSource}
			disabled={isLoading}
			onchange={handleFacetChange}
		>
			<option value="">Any sync source</option>
			<option value="backstage">Backstage</option>
		</select>

		<select
			aria-label="Filter by sync status"
			bind:value={syncStatus}
			disabled={isLoading}
			onchange={handleFacetChange}
		>
			<option value="">Any sync status</option>
			<option value="stale">Stale</option>
		</select>

		{#if hasAnyFilter}
			<button type="button" class="clear-btn" onclick={handleClear} disabled={isLoading}>
				Clear
			</button>
		{/if}
	</div>
</form>

<style>
	.identity-search-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.input-wrap {
		flex: 1 1 260px;
		min-width: 200px;
	}

	.input-wrap input {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-secondary);
		color: var(--color-text);
		font-size: 0.95rem;
	}

	.input-wrap input:focus {
		outline: none;
		border-color: var(--color-accent);
	}

	.input-wrap input:disabled {
		opacity: 0.6;
	}

	button[type='submit'] {
		padding: 0.5rem 1.25rem;
		background: var(--color-accent);
		color: white;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		font-size: 0.95rem;
		font-weight: 500;
		cursor: pointer;
	}

	button[type='submit']:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	button[type='submit']:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.facets {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
	}

	.facets select {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.85rem;
	}

	.facets select:disabled {
		opacity: 0.6;
	}

	.clear-btn {
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.clear-btn:hover:not(:disabled) {
		background: var(--color-hover);
		color: var(--color-text);
	}

	.clear-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
