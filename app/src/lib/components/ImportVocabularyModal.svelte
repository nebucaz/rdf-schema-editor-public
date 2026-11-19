<script lang="ts">
	/** Import wizard of the Vocabulary page (skos-support STORY-418): choose a Turtle or CSV file, review a dry-run
	 *  preview, apply. The file is read in the browser and nothing is written until Apply; `onApply` does the single
	 *  write. Skipped content is a visible banner, never ignored silently. */
	import Modal from './Modal.svelte';
	import { DEFAULT_NAMESPACE_BASE_IRI } from '#lib/config.js';
	import { buildImportPlan, parseSkosTurtle, ImportRefused, type ImportPlan, type PlanEntry } from '#lib/services/skos-import.js';
	import { parseSkosCsv, readCsvHeaders } from '#lib/services/skos-import-csv.js';
	import { commonImportBase, retargetImport, retargetProblem, type RetargetOptions } from '#lib/services/skos-import-retarget.js';
	import { conceptSchemeIri } from '#lib/utils/iri.js';
	import { importChangeSummary, selectImportWrites, type EntryDecision, type ImportWrites } from '#lib/services/skos-import-apply.js';
	import type { SkosVocabulary } from '#lib/services/skos-export.js';
	import type { GateFinding } from '#lib/services/gates/types.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		isOpen: boolean;
		/** What the vocabulary holds now; the preview compares the file with it. */
		existing: SkosVocabulary;
		coreBaseIri?: string;
		/** Writes the selection; resolves with the log problem (if any) and the gate findings. */
		onApply: (writes: ImportWrites) => Promise<{ logProblem: string | null; findings: GateFinding[] }>;
		onClose: () => void;
	}

	let { isOpen, existing, coreBaseIri = DEFAULT_NAMESPACE_BASE_IRI, onApply, onClose }: Props = $props();

	const COLUMN_CHOICES = ['ignore', 'scheme', 'iri', 'notation', 'prefLabel', 'definition', 'altLabel', 'hiddenLabel', 'broader', 'related'];
	const TABS = ['New', 'Changed', 'Conflicting', 'Similar', 'Skipped'] as const;
	type Tab = (typeof TABS)[number];

	let step = $state<1 | 2 | 3>(1);
	let fileName = $state('');
	let text = $state('');
	let format = $state<'turtle' | 'csv'>('turtle');
	let unknownColumns = $state<string[]>([]);
	let columnMap = $state<Record<string, string>>({});
	let error = $state<string | null>(null);
	let plan = $state<ImportPlan | null>(null);
	let entryDecisions = $state<Record<string, EntryDecision>>({});
	let sameAs = $state<Record<string, string>>({});
	let tab = $state<Tab>('New');
	let busy = $state(false);
	// Where the import lands (all optional): own IRIs for the file's, and one scheme for every concept.
	const NEW_SCHEME = '__new__';
	let rewriteIris = $state(false);
	let fromBase = $state('');
	let toBase = $state('');
	let schemeChoice = $state('');
	let newSchemeName = $state('');
	let result = $state<{ summary: string; logProblem: string | null; findings: GateFinding[]; rejected: ImportWrites['rejected'] } | null>(null);

	async function readText(file: File): Promise<string> {
		if (typeof file.text === 'function') return file.text();
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result ?? ''));
			reader.onerror = () => reject(reader.error);
			reader.readAsText(file);
		});
	}

	async function pick(file: File | undefined) {
		error = null;
		plan = null;
		if (!file) return;
		fileName = file.name;
		format = /\.csv$/i.test(file.name) ? 'csv' : 'turtle';
		try {
			text = await readText(file);
			columnMap = {};
			unknownColumns = format === 'csv' ? readCsvHeaders(text).unknown : [];
			rewriteIris = false;
			fromBase = format === 'turtle' ? detectBase(text) : '';
			toBase = `${coreBaseIri}#`;
		} catch {
			error = 'The file could not be read.';
		}
	}

	/** The IRI start the file's concepts share, offered as the part to replace; '' when the file cannot be read yet. */
	function detectBase(source: string): string {
		try {
			return commonImportBase(parseSkosTurtle(source));
		} catch {
			return '';
		}
	}

	function retargetOptions(): RetargetOptions {
		const options: RetargetOptions = {};
		if (rewriteIris && format === 'turtle') {
			options.fromBase = fromBase;
			options.toBase = toBase;
		}
		if (schemeChoice === NEW_SCHEME) options.scheme = { kind: 'new', name: newSchemeName, iri: newSchemeName.trim() ? conceptSchemeIri(newSchemeName.trim(), coreBaseIri) : '' };
		else if (schemeChoice) options.scheme = { kind: 'existing', iri: schemeChoice };
		return options;
	}

	function preview() {
		error = null;
		try {
			const options = retargetOptions();
			const problem = retargetProblem(options);
			if (problem) {
				error = problem;
				return;
			}
			const read =
				format === 'csv'
					? parseSkosCsv(text, { coreBaseIri, existing: existing.concepts, columnMap })
					: parseSkosTurtle(text);
			const parsed = retargetImport(read, options);
			plan = buildImportPlan(parsed, existing);
			entryDecisions = {};
			sameAs = {};
			tab = plan.counts.new ? 'New' : plan.counts.changed ? 'Changed' : plan.counts.conflicting ? 'Conflicting' : 'New';
			step = 2;
		} catch (e) {
			error = e instanceof ImportRefused || e instanceof Error ? e.message : 'The file could not be read.';
		}
	}

	const localName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;
	const titleOf = (e: PlanEntry) => {
		if (e.kind === 'scheme') return e.imported.name || localName(e.iri);
		return e.imported.prefLabels[0]?.text || localName(e.iri);
	};
	const existingTitle = (iri: string) => existing.concepts.find((c) => c.iri === iri)?.prefLabels[0]?.text ?? localName(iri);

	const byStatus = (status: PlanEntry['status']) => (plan?.entries ?? []).filter((e) => e.status === status);
	const writes = $derived(plan ? selectImportWrites(plan, existing, { entries: entryDecisions, sameAs: Object.fromEntries(Object.entries(sameAs).filter(([, v]) => v)) }, fileName) : null);
	const nothingToWrite = $derived(!writes || writes.schemes.length + writes.concepts.length + writes.collections.length === 0);
	const count = (t: Tab) =>
		!plan ? 0 : t === 'Skipped' ? plan.skipped.length : t === 'Similar' ? plan.similar.length : plan.counts[t.toLowerCase() as 'new' | 'changed' | 'conflicting'];

	async function apply() {
		if (!writes) return;
		busy = true;
		error = null;
		try {
			const { logProblem, findings } = await onApply(writes);
			result = { summary: importChangeSummary(writes), logProblem, findings, rejected: writes.rejected };
			step = 3;
		} catch (e) {
			error = e instanceof Error ? e.message : 'The import failed';
		} finally {
			busy = false;
		}
	}

	function close() {
		step = 1;
		plan = null;
		text = '';
		fileName = '';
		rewriteIris = false;
		fromBase = '';
		toBase = '';
		schemeChoice = '';
		newSchemeName = '';
		unknownColumns = [];
		error = null;
		result = null;
		onClose();
	}
</script>

<Modal {isOpen} title="Import vocabulary" onClose={close} maxWidth="760px" dismissible={false}>
	{#if step === 1}
		<div class="step">
			<label>
				Vocabulary file
				<input type="file" accept=".ttl,.turtle,.csv,text/turtle,text/csv,text/plain" onchange={(e) => pick(e.currentTarget.files?.[0])} />
			</label>
			<p class="hint">SKOS Turtle or a spreadsheet saved as CSV. The file is read in your browser; nothing is changed until you choose Apply.</p>
			{#if fileName}<p>{fileName} ({format === 'csv' ? 'CSV' : 'Turtle'})</p>{/if}
			{#if unknownColumns.length}
				<fieldset>
					<legend>Columns the import does not know</legend>
					{#each unknownColumns as header (header)}
						<label class="inline">
							{header}
							<select aria-label="Column {header}" value={columnMap[header] ?? ''} onchange={(e) => (columnMap[header] = e.currentTarget.value)}>
								<option value="">(choose)</option>
								{#each COLUMN_CHOICES as choice (choice)}<option value={choice}>{choice}</option>{/each}
								<option value="prefLabel@de">prefLabel@de</option>
								<option value="prefLabel@en">prefLabel@en</option>
							</select>
						</label>
					{/each}
				</fieldset>
			{/if}
			{#if text}
				<fieldset class="landing">
					<legend>Where it lands</legend>
					<p class="hint">Always the vocabulary graph of this repository. You can also choose the IRIs and the scheme.</p>
					{#if format === 'turtle'}
						<label class="inline">
							<input type="checkbox" bind:checked={rewriteIris} />
							Use my own IRIs instead of the file's
						</label>
						{#if rewriteIris}
							<label>
								IRI start in the file
								<input type="text" bind:value={fromBase} placeholder="http://example.org/sample#" />
							</label>
							<label>
								Replace it with
								<input type="text" bind:value={toBase} placeholder="{coreBaseIri}#" />
							</label>
						{/if}
					{/if}
					<label>
						Scheme for every concept
						<select bind:value={schemeChoice}>
							<option value="">As in the file</option>
							{#each existing.schemes as sch (sch.iri)}<option value={sch.iri}>{sch.name || localName(sch.iri)}</option>{/each}
							<option value={NEW_SCHEME}>A new scheme…</option>
						</select>
					</label>
					{#if schemeChoice === NEW_SCHEME}
						<label>
							New scheme name
							<input type="text" bind:value={newSchemeName} placeholder="e.g. Asset classification" />
						</label>
					{/if}
				</fieldset>
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<button type="button" onclick={close}>Cancel</button>
				<button type="button" onclick={preview} disabled={!text}>Preview import</button>
			</div>
		</div>
	{:else if step === 2 && plan}
		<div class="step">
			{#if plan.counts.skipped > 0}
				<p class="banner" role="status">
					{plan.counts.skipped} {plan.counts.skipped === 1 ? 'triple was' : 'triples were'} not imported (see Skipped).
				</p>
			{/if}
			{#each plan.errors as issue (issue.message)}<p class="error" role="alert">{issue.message}</p>{/each}
			<div role="tablist" class="tabs">
				{#each TABS as t (t)}
					<button type="button" role="tab" aria-selected={tab === t} onclick={() => (tab = t)}>{t} ({count(t)})</button>
				{/each}
			</div>
			<ul class="entries">
				{#if tab === 'New'}
					{#each byStatus('new') as e (e.iri)}
						<li>
							<label class="inline">
								<input type="checkbox" aria-label="Import {titleOf(e)}" checked={entryDecisions[e.iri] !== 'skip'} onchange={(ev) => (entryDecisions[e.iri] = ev.currentTarget.checked ? 'take' : 'skip')} />
								{titleOf(e)} <span class="hint">{e.kind}</span>
							</label>
						</li>
					{/each}
				{:else if tab === 'Changed' || tab === 'Conflicting'}
					{#each byStatus(tab === 'Changed' ? 'changed' : 'conflicting') as e (e.iri)}
						<li>
							<strong>{titleOf(e)}</strong>
							{#if e.reason}<span class="hint">{e.reason}</span>{/if}
							<ul>
								{#each e.changes as ch (ch.property + ch.after)}<li class="hint">{ch.property}: {ch.before || '(none)'} → {ch.after}</li>{/each}
							</ul>
							<select aria-label="Decision for {titleOf(e)}" value={entryDecisions[e.iri] ?? 'keep'} onchange={(ev) => (entryDecisions[e.iri] = ev.currentTarget.value as EntryDecision)}>
								<option value="keep">Keep existing</option>
								<option value="take">Take imported</option>
								<option value="skip">Skip</option>
							</select>
						</li>
					{/each}
				{:else if tab === 'Similar'}
					{#each plan.similar as s (s.importedIri + s.existingIri)}
						{@const title = localName(s.importedIri)}
						<li>
							<strong>{title}</strong> <span class="hint">looks like {existingTitle(s.existingIri)} ({s.match}, {s.via} label "{s.label}")</span>
							<select aria-label="Same as for {title}" value={sameAs[s.importedIri] ?? ''} onchange={(ev) => (sameAs[s.importedIri] = ev.currentTarget.value)}>
								<option value="">Import as a new concept</option>
								<option value={s.existingIri}>Same as {existingTitle(s.existingIri)}</option>
							</select>
						</li>
					{/each}
				{:else}
					{#each plan.skipped as s (s.predicate)}
						<li><code>{localName(s.predicate)}</code> × {s.count}: <span class="hint">{s.reason}</span></li>
					{/each}
				{/if}
			</ul>
			{#each plan.info as issue (issue.message)}<p class="hint">{issue.message}</p>{/each}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="actions">
				<button type="button" onclick={() => (step = 1)}>Back</button>
				<button type="button" onclick={apply} disabled={busy || nothingToWrite}>{busy ? 'Importing…' : 'Apply import'}</button>
			</div>
		</div>
	{:else if result}
		<div class="step">
			<p role="status">{result.summary}</p>
			{#if result.logProblem}<p class="error" role="alert">{result.logProblem}</p>{/if}
			{#each result.rejected as r (r.iri)}<p class="error">{localName(r.iri)} was not imported: {r.reason}</p>{/each}
			{#if result.findings.length}
				<h3>Findings on the imported concepts</h3>
				<ul class="entries">
					{#each result.findings as f (f.gateId + f.elementIri)}
						<li>
							<span>{f.message}</span>
							<a href={appUrl(`/vocabulary?concept=${encodeURIComponent(f.elementIri)}`)}>Open</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">No gate findings on the imported concepts.</p>
			{/if}
			<div class="actions"><button type="button" onclick={close}>Done</button></div>
		</div>
	{/if}
</Modal>

<style>
	.step {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.inline {
		flex-direction: row;
		align-items: center;
		gap: 0.4rem;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.banner {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.tabs button[aria-selected='true'] {
		font-weight: 600;
		border-bottom: 2px solid var(--color-accent);
	}

	.entries {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		max-height: 18rem;
		overflow: auto;
	}

	fieldset {
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}

	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.3rem 0.5rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.actions button {
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--color-accent);
		border-radius: 6px;
		background: transparent;
		color: var(--color-accent);
		font-size: 0.85rem;
	}

	.actions button:hover:not(:disabled) {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.actions button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.actions button:last-child:not(:first-child) {
		background: var(--color-accent);
		color: var(--color-bg);
	}

	.actions button:last-child:not(:first-child):hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	a {
		text-decoration: underline;
	}
</style>
