<script lang="ts" module>
	/** STORY-130's response shape, mirrored exactly (`backend/internal/validation/check.go`'s
	 *  `Violation` struct) — one row per `(individualIri, typeIri, path, constraint)` violation. */
	export interface ValidationViolation {
		individualIri: string;
		individualLabel: string;
		typeIri: string;
		path: string;
		constraint: string;
		message: string;
	}
</script>

<script lang="ts">
	import { extractLocalName } from '$lib/utils/iri';
	import { buildIdentitySearchUrl } from '$lib/utils/identity-search-url';
	import { toCurie, curieifyText, namespaceOf } from '$lib/utils/curie';
	import { namespaceStore } from '$lib/stores/namespace-store.svelte';
	import { validationReportFilterStore } from '$lib/stores/validation-report-filter-store.svelte';

	/**
	 * STORY-132: read-only report — a "Run Validation" button calls the STORY-131 proxy route
	 * (`/api/validation/report`, itself forwarding to the Go backend's `GET /validation/report`) and
	 * renders the resulting violation list. Per Decision 4 (`research.md` §6/`plan.md`'s ADR table),
	 * purely transient: no store, no `localStorage` — a page reload or a second "Run Validation"
	 * click always starts from an empty result set and refetches. Never touches `sparqlConnector`
	 * directly (`plan.md` STORY-132's "Implementation Notes") — this component only ever calls the
	 * SvelteKit proxy route via `fetch`, exactly like `MissingConceptsPanel`.
	 */

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let hasRun = $state(false);
	let violations = $state<ValidationViolation[]>([]);

	/** The header's `NamespaceFilter` hides violations by the *individual's* own namespace (not its
	 *  type's — an individual can be typed by a class from a different namespace, e.g. a
	 *  Backstage-synced individual, but it's still that individual's own namespace the user is
	 *  choosing to show/hide). An individual whose namespace can't be resolved (no registered
	 *  namespace's base matches) is never hidden — there's nothing for the filter to name it by. */
	const visibleViolations = $derived(
		violations.filter((v) => {
			const ns = namespaceOf(v.individualIri, namespaceStore.namespaces);
			return ns === null || !validationReportFilterStore.hiddenNamespaces.has(ns);
		})
	);

	async function runValidation() {
		loading = true;
		loadError = null;
		try {
			// Namespace prefixes for the CURIE-compacted display below — usually already loaded by
			// `+layout.svelte`'s own `ensureLoaded()` call, but calling it again here is a no-op once
			// loaded and keeps this component correct standalone.
			const [response] = await Promise.all([fetch('/api/validation/report'), namespaceStore.ensureLoaded()]);
			if (!response.ok) {
				throw new Error(`Validation report failed: ${response.status} ${response.statusText}`);
			}
			const data = await response.json();
			violations = Array.isArray(data) ? data : [];
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to run validation';
			violations = [];
		} finally {
			hasRun = true;
			loading = false;
		}
	}

	/** `prefix:LocalName` display for a type/path IRI — falls back to a bare local name when no
	 *  registered namespace's base matches (e.g. an external vocabulary IRI). */
	function displayIri(iri: string): string {
		const curie = toCurie(iri, namespaceStore.namespaces);
		return curie === iri ? extractLocalName(iri) : curie;
	}

	/** The individual's real `rdfs:label` when it has one; otherwise its CURIE, which is more useful
	 *  here than a fabricated "Title Case" guess at a label. */
	function displayIndividual(v: ValidationViolation): string {
		return v.individualLabel && v.individualLabel.trim() ? v.individualLabel : displayIri(v.individualIri);
	}

	function displayMessage(message: string): string {
		return curieifyText(message, namespaceStore.namespaces);
	}
</script>

<div class="report">
	<div class="toolbar">
		<button type="button" class="run-btn" onclick={() => void runValidation()} disabled={loading}>
			{loading ? 'Running…' : 'Run Validation'}
		</button>
	</div>

	{#if loadError}
		<p class="error">{loadError}</p>
	{:else if !hasRun}
		<p class="hint">Click "Run Validation" to check every identity against its SHACL shapes.</p>
	{:else if violations.length === 0}
		<p class="hint">No violations found — every identity conforms to its shapes.</p>
	{:else if visibleViolations.length === 0}
		<p class="hint">
			{violations.length} violation{violations.length === 1 ? '' : 's'} found, but every one is hidden by the
			current namespace filter.
		</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Identity</th>
					<th>Type</th>
					<th>Path</th>
					<th>Constraint</th>
					<th>Message</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleViolations as v (v.individualIri + v.typeIri + v.path + v.constraint)}
					<tr>
						<td>
							<a href={buildIdentitySearchUrl({ node: v.individualIri })} title={v.individualIri}>
								{displayIndividual(v)}
							</a>
						</td>
						<td title={v.typeIri}>{displayIri(v.typeIri)}</td>
						<td title={v.path}>{displayIri(v.path)}</td>
						<td>{v.constraint}</td>
						<td>{displayMessage(v.message)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	.report {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.toolbar {
		display: flex;
	}

	.run-btn {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.9rem;
		cursor: pointer;
	}

	.run-btn:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg-secondary);
	}

	.run-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: 0.9rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.9rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th {
		text-align: left;
		color: var(--color-text-muted);
		font-weight: 600;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
	}

	td {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text);
		vertical-align: top;
	}

	tr:last-child td {
		border-bottom: none;
	}

	td a {
		color: var(--color-accent);
	}
</style>
