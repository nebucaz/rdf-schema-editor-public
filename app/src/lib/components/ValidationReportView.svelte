<script lang="ts" module>
	import type { ValidationFinding } from '#lib/services/validation-report-model.js';

	/** One finding of the report; defined with the report model, kept here under its old name. */
	export type ValidationViolation = ValidationFinding;

	/** A constraint the run could not check (`backend/internal/validation/check.go`'s `NotChecked`). */
	export interface NotCheckedConstraint {
		shapeIri: string;
		ruleId: string;
		construct: string;
		reason: string;
	}
</script>

<script lang="ts">
	import { apiUrl } from '#lib/utils/urls.js';
	import { extractLocalName } from '#lib/utils/iri.js';
	import { buildIdentitySearchUrl } from '#lib/utils/identity-search-url.js';
	import { toCurie, curieifyText, namespaceOf } from '#lib/utils/curie.js';
	import { namespaceStore } from '#lib/stores/namespace-store.svelte.js';
	import { downloadFile } from '#lib/utils/download.js';
	import { APP_VERSION } from '#lib/utils/app-version.js';
	import {
		reportToCsv,
		reportToJson,
		reportToMarkdown,
		exportFilename,
		type ExportKind
	} from '#lib/services/validation-report-export.js';
	import {
		groupFindings,
		summarize,
		valueCell,
		findingKey,
		type ReportView
	} from '#lib/services/validation-report-model.js';
	import { validationReportSession } from '#lib/stores/validation-report-session.svelte.js';
	import { validationReportFilterStore } from '#lib/stores/validation-report-filter-store.svelte.js';

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
	// Report state lives in a session store, so Back from an identity page restores the report.
	const session = validationReportSession;
	const hasRun = $derived(session.hasRun);
	const loadError = $derived(session.loadError);
	const violations = $derived(session.violations);
	const notChecked = $derived(session.notChecked);
	const runAt = $derived(session.runAt);
	const view = $derived(session.view);
	const folded = $derived(session.folded);

	const VIEWS: { id: ReportView; label: string }[] = [
		{ id: 'identity', label: 'Identity' },
		{ id: 'rule', label: 'Rule' },
		{ id: 'dimension', label: 'Quality dimension' },
		{ id: 'none', label: 'None' }
	];
	/** Identity blocks the reader folded (by identity IRI); display only, never part of counts or exports. */
	/** Stamped on the client when the response arrives (no backend change). */
	let exportOpen = $state(false);

	function toggleFold(key: string) {
		const next = new Set(folded);
		if (!next.delete(key)) next.add(key);
		session.folded = next;
	}

	const notCheckedShapeCount = $derived(new Set(notChecked.map((n) => n.shapeIri)).size);
	const notCheckedSummary = $derived(
		`${notChecked.length} constraint${notChecked.length === 1 ? '' : 's'} in ${notCheckedShapeCount} shape${
			notCheckedShapeCount === 1 ? '' : 's'
		} ${notChecked.length === 1 ? 'is' : 'are'} not checked by this report`
	);

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

	const groups = $derived(groupFindings(visibleViolations, view));
	const summary = $derived(summarize(visibleViolations));
	const summaryText = $derived(
		`${summary.findings} finding${summary.findings === 1 ? '' : 's'} in ${summary.identities} identit${
			summary.identities === 1 ? 'y' : 'ies'
		}`
	);
	const summaryParts = $derived(
		view === 'rule'
			? summary.byRule.map((r) => `${r.ruleId || 'No rule id'}: ${r.count}`)
			: view === 'dimension'
				? summary.byDimension.map((d) => `${d.dimension || 'Unspecified'}: ${d.count}`)
				: []
	);

	const rowKey = findingKey;

	/** What the Value column prints: literals quoted so `""` and `"  "` are visible, IRIs as CURIEs. */
	function valueText(v: ValidationViolation): string {
		const cell = valueCell(v);
		if (cell.kind === 'none') return '';
		if (cell.kind === 'literal') return `"${cell.text}"`;
		return displayIri(cell.text);
	}

	function typesOf(rows: ValidationViolation[]): string {
		return [...new Set(rows.map((r) => displayIri(r.typeIri)))].join(', ');
	}

	const canExport = $derived(hasRun && !loadError && runAt !== null);

	const EXPORTS: Record<ExportKind, { label: string; mime: string; build: typeof reportToCsv }> = {
		csv: { label: 'CSV', mime: 'text/csv;charset=utf-8', build: reportToCsv },
		json: { label: 'JSON', mime: 'application/json', build: reportToJson },
		md: { label: 'Markdown', mime: 'text/markdown;charset=utf-8', build: reportToMarkdown }
	};

	/** Exports what is on screen: the namespace-filtered findings, the chosen view, plus notChecked. */
	function exportAs(kind: ExportKind) {
		exportOpen = false;
		if (!runAt) return;
		const { mime, build } = EXPORTS[kind];
		const text = build({
			findings: visibleViolations,
			notChecked,
			view,
			runAt,
			appVersion: APP_VERSION,
			hiddenNamespaces: [...validationReportFilterStore.hiddenNamespaces]
		});
		downloadFile(exportFilename(kind, runAt), text, mime);
	}

	function exportPdf() {
		exportOpen = false;
		window.print();
	}

	async function runValidation() {
		session.folded = new Set();
		loading = true;
		session.loadError = null;
		try {
			// Namespace prefixes for the CURIE-compacted display below — usually already loaded by
			// `+layout.svelte`'s own `ensureLoaded()` call, but calling it again here is a no-op once
			// loaded and keeps this component correct standalone.
			const [response] = await Promise.all([fetch(apiUrl('/validation/report')), namespaceStore.ensureLoaded()]);
			if (!response.ok) {
				throw new Error(`Validation report failed: ${response.status} ${response.statusText}`);
			}
			const data = await response.json();
			session.violations = Array.isArray(data?.violations) ? data.violations : [];
			session.notChecked = Array.isArray(data?.notChecked) ? data.notChecked : [];
			session.runAt = new Date();
		} catch (err) {
			session.loadError = err instanceof Error ? err.message : 'Failed to run validation';
			session.violations = [];
			session.notChecked = [];
		} finally {
			session.hasRun = true;
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

{#snippet findingsTable(rows: ValidationViolation[], withIdentity: boolean)}
	<!-- Fixed layout and shared column widths, so the columns line up across all tables of the report. -->
	<table class="findings" class:with-identity={withIdentity}>
		<thead>
			<tr>
				{#if withIdentity}
					<th class="col-identity">Identity</th>
					<th class="col-type">Type</th>
				{/if}
				<th class="col-message">Message</th>
				<th class="col-rule">Rule</th>
				<th class="col-path">Path</th>
				<th class="col-constraint">Constraint</th>
				<th class="col-value">Value</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as v (rowKey(v))}
				<tr>
					{#if withIdentity}
						<td>
							<a href={buildIdentitySearchUrl({ node: v.individualIri })} title={v.individualIri}>
								{displayIndividual(v)}
							</a>
						</td>
						<td title={v.typeIri}>{displayIri(v.typeIri)}</td>
					{/if}
					<td>{displayMessage(v.message)}</td>
					<td title={v.shapeIri}>{v.ruleId}</td>
					<td title={v.path}>{displayIri(v.path)}</td>
					<td>{v.constraint}</td>
					<td class="value">{valueText(v)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

{#snippet notCheckedTable()}
	<table class="not-checked">
		<thead>
			<tr><th>Rule</th><th>Construct</th><th>Reason</th></tr>
		</thead>
		<tbody>
			{#each notChecked as n, i (i)}
				<tr>
					<td title={n.shapeIri}>{n.ruleId || displayIri(n.shapeIri)}</td>
					<td>{n.construct}</td>
					<td>{n.reason}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/snippet}

<div class="report">
	{#if canExport && runAt}
		<div class="print-header print-only">
			<h2>Validation report</h2>
			<p>Run {runAt.toISOString()} · App version {APP_VERSION}</p>
			<p>Result: {summaryText}</p>
		</div>
	{/if}
	<div class="toolbar no-print">
		<button type="button" class="run-btn" onclick={() => void runValidation()} disabled={loading}>
			{loading ? 'Running…' : 'Run Validation'}
		</button>
		<div class="export no-print">
			<button
				type="button"
				class="export-btn"
				aria-haspopup="menu"
				aria-expanded={exportOpen}
				disabled={!canExport}
				onclick={() => (exportOpen = !exportOpen)}
			>
				Export
			</button>
			{#if exportOpen && canExport}
				<div class="export-menu" role="menu">
					{#each Object.entries(EXPORTS) as [kind, entry] (kind)}
						<button type="button" role="menuitem" onclick={() => exportAs(kind as ExportKind)}>{entry.label}</button>
					{/each}
					<button type="button" role="menuitem" onclick={exportPdf}>PDF</button>
				</div>
			{/if}
		</div>
	</div>

	{#if hasRun && !loadError && notChecked.length > 0}
		<div class="no-print">
		<details class="banner">
			<summary>{notCheckedSummary}</summary>
			{@render notCheckedTable()}
		</details>
		</div>
		<div class="print-only">
			<p class="print-note">Note: {notCheckedSummary}.</p>
			{@render notCheckedTable()}
		</div>
	{/if}

	{#if loadError}
		<p class="error">{loadError}</p>
	{:else if !hasRun}
		<p class="hint">Click "Run Validation" to check every identity against its SHACL shapes.</p>
	{:else if violations.length === 0}
		<p class="hint">
			{notChecked.length > 0
				? 'No violations found among the checked constraints.'
				: 'No violations found — every identity conforms to its shapes.'}
		</p>
	{:else if visibleViolations.length === 0}
		<p class="hint">
			{violations.length} violation{violations.length === 1 ? '' : 's'} found, but every one is hidden by the
			current namespace filter.
		</p>
	{:else}
		<div class="view-bar no-print">
			<div class="group-by" role="radiogroup" aria-label="Group by">
				<span class="group-by-label">Group by</span>
				{#each VIEWS as option (option.id)}
					<label>
						<input type="radio" name="report-view" value={option.id} bind:group={session.view} onchange={() => (session.folded = new Set())} />
						{option.label}
					</label>
				{/each}
			</div>
		</div>
		<p class="summary no-print">
			<span>{summaryText}</span>
			{#if view === 'identity'}
				<span class="fold-all">
					<button type="button" onclick={() => (session.folded = new Set(groups.map((g) => g.key)))}>Collapse all</button>
					<button type="button" onclick={() => (session.folded = new Set())}>Expand all</button>
				</span>
			{/if}
			{#each summaryParts as part (part)}
				<span class="summary-part">{part}</span>
			{/each}
		</p>
		{#if view === 'identity'}
			{#each groups as group (group.key)}
				<section class="identity-block">
					<h3 class="identity-heading">
						<button
							type="button"
							class="fold-btn no-print"
							class:is-folded={folded.has(group.key)}
							aria-expanded={!folded.has(group.key)}
							aria-label="{displayIndividual(group.findings[0])} findings"
							onclick={() => toggleFold(group.key)}
						></button>
						<a href={buildIdentitySearchUrl({ node: group.key })} title={group.key}>
							{displayIndividual(group.findings[0])}
						</a>
						<span class="identity-type">{typesOf(group.findings)}</span>
						<span class="identity-count">
							{group.findings.length} finding{group.findings.length === 1 ? '' : 's'}
						</span>
					</h3>
					<div class="block-body" class:folded={folded.has(group.key)}>
						{@render findingsTable(group.findings, false)}
					</div>
				</section>
			{/each}
		{:else if view === 'none'}
			{@render findingsTable(visibleViolations, true)}
		{:else}
			{#each groups as group (group.key)}
				<h3 class="group-heading">{group.title} ({group.findings.length})</h3>
				{@render findingsTable(group.findings, true)}
			{/each}
		{/if}
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
		gap: 0.5rem;
	}

	.export {
		position: relative;
	}

	.export-btn {
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: transparent;
		color: var(--color-text);
		font-size: 0.9rem;
		cursor: pointer;
	}

	.export-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.export-menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		min-width: 9rem;
		margin-top: 0.25rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg-secondary);
	}

	.export-menu button {
		padding: 0.45rem 0.8rem;
		border: none;
		background: transparent;
		color: var(--color-text);
		font-size: 0.85rem;
		text-align: left;
		cursor: pointer;
	}

	.export-menu button:hover {
		background: var(--color-border);
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

	.banner {
		border: 1px solid var(--color-warning);
		border-radius: 6px;
		background: var(--color-warning-bg);
		color: var(--color-text);
		padding: 0.5rem 0.75rem;
		font-size: 0.9rem;
	}

	.banner summary {
		cursor: pointer;
		color: var(--color-warning);
		font-weight: 600;
	}

	.group-by {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.9rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.group-by label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-text);
	}

	.summary-part {
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.identity-block {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.25rem 0.75rem 0.5rem;
	}

	.identity-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		margin: 0.4rem 0;
		font-size: 0.95rem;
		color: var(--color-text);
	}

	.identity-type,
	.identity-count {
		font-size: 0.8rem;
		font-weight: 400;
		color: var(--color-text-muted);
	}

	.fold-all {
		display: flex;
		gap: 0.4rem;
		font-weight: 400;
	}

	.fold-all button {
		padding: 0.15rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 4px;
		background: transparent;
		color: var(--color-text-muted);
		font-size: 0.8rem;
		cursor: pointer;
	}

	.fold-btn {
		width: 1.25rem;
		height: 1.25rem;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text-muted);
		cursor: pointer;
	}

	.fold-btn::before {
		content: '▾';
	}

	.fold-btn.is-folded::before {
		content: '▸';
	}

	.block-body.folded {
		display: none;
	}

	table.findings {
		table-layout: fixed;
	}

	.col-message {
		width: 34%;
	}

	.col-rule {
		width: 16%;
	}

	.col-path {
		width: 16%;
	}

	.col-constraint {
		width: 10%;
	}

	.col-value {
		width: 24%;
	}

	.with-identity .col-identity {
		width: 12%;
	}

	.with-identity .col-type {
		width: 10%;
	}

	.with-identity .col-message {
		width: 26%;
	}

	.with-identity .col-rule {
		width: 12%;
	}

	.with-identity .col-path {
		width: 12%;
	}

	.with-identity .col-constraint {
		width: 8%;
	}

	.with-identity .col-value {
		width: 20%;
	}

	table.findings td {
		overflow-wrap: anywhere;
	}

	td.value {
		font-family: monospace;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.group-heading {
		margin: 0.5rem 0 0;
		font-size: 0.95rem;
		color: var(--color-text);
	}

	.not-checked {
		margin-top: 0.5rem;
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

	.print-only {
		display: none;
	}

	@media print {
		.no-print {
			display: none !important;
		}
		.print-only {
			display: block;
		}
		.print-header h2,
		.print-header p {
			margin: 0 0 0.25rem;
		}
		.block-body.folded {
			display: block !important;
		}
		.identity-block {
			break-inside: avoid;
			border-color: #999;
		}
		tr {
			break-inside: avoid;
		}
		thead {
			display: table-header-group;
		}
		.report,
		td,
		th,
		.group-heading,
		.identity-heading,
		.identity-type,
		.identity-count,
		.print-note {
			background: #fff;
			color: #000;
		}
		td,
		th {
			border-bottom-color: #bbb;
		}
		td a {
			color: #000;
			text-decoration: none;
		}
	}
</style>
