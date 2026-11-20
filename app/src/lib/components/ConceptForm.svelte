<script lang="ts">
	/** Add/edit form for one SKOS concept (ontology-pipeline STORY-323). Validation is the pure
	 *  `validateConceptDraft`; while the preferred label is typed, `findSimilarConcepts` suggests an
	 *  existing concept and offers to record the typed term as its alternative label instead. */
	import { collectionsOfConcept, type SkosCollection } from '#lib/services/skos-collection.js';
	import { resolveAuthorityInput, type BusinessUnit } from '#lib/services/business-unit.js';
	import AuthorityPicker from './AuthorityPicker.svelte';
	import RationaleField from './RationaleField.svelte';
	import {
		COMMON_LANG_TAGS,
		conceptTitle,
		findSimilarConcepts,
		isValidLangTag,
		languagesOf,
		schemeDisplayName,
		textIn,
		validateConceptDraft,
		type Concept,
		type ConceptDraft,
		type ConceptScheme,
		type LangText
	} from '#lib/services/skos-concept.js';

	interface Props {
		initial?: Concept;
		schemes: ConceptScheme[];
		/** Concepts already in the vocabulary, for the duplicate check. */
		existing: Concept[];
		onSave: (draft: ConceptDraft) => Promise<void>;
		onCancel: () => void;
		onAddAlternative: (conceptIri: string, text: string, lang: string) => Promise<void>;
		/** Why the change is made; the page writes it to the change log. */
		rationale?: string;
		/** The vocabulary's collections; the ones holding this concept are listed read-only. */
		collections?: SkosCollection[];
		/** The business units that can hold authority; a typed name that matches none is created on save. */
		businessUnits?: BusinessUnit[];
	}

	let { initial, schemes, existing, onSave, onCancel, onAddAlternative, rationale = $bindable(''), collections = [], businessUnits = [] }: Props = $props();

	const memberOf = $derived(initial ? collectionsOfConcept(collections, initial.iri) : []);

	const linesOf = (labels: LangText[], lang: string) =>
		labels.filter((l) => l.text.trim() && sameLang(l.lang, lang)).map((l) => l.text).join('\n');

	/** One language's texts. Everything that is not language-specific stays outside the tabs. */
	interface Tab {
		lang: string;
		pref: string;
		alt: string;
		hidden: string;
		definition: string;
		scopeNote: string;
	}

	function sameLang(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase();
	}

	function buildTabs(c: Concept | undefined): Tab[] {
		if (!c) return [emptyTab('en')];
		const first = c.prefLabels.find((p) => p.text.trim())?.lang.trim().toLowerCase();
		const langs = languagesOf(c);
		// The language of the first preferred label leads, because that label is the concept's primary one.
		const ordered = first === undefined ? langs : [first, ...langs.filter((l) => l !== first)];
		if (!ordered.length) return [emptyTab('en')];
		return ordered.map((lang) => ({
			lang,
			pref: textIn(c.prefLabels, lang),
			alt: linesOf(c.altLabels, lang),
			hidden: linesOf(c.hiddenLabels, lang),
			definition: textIn(c.definitions, lang),
			scopeNote: textIn(c.scopeNotes, lang)
		}));
	}

	function emptyTab(lang: string): Tab {
		return { lang, pref: '', alt: '', hidden: '', definition: '', scopeNote: '' };
	}

	// The form edits a copy: `initial` seeds it once and later prop changes do not overwrite the input.
	/* svelte-ignore state_referenced_locally */
	let tabs = $state<Tab[]>(buildTabs(initial));
	let activeIndex = $state(0);
	/* svelte-ignore state_referenced_locally */
	let disambiguation = $state(initial?.disambiguation ?? '');
	/* svelte-ignore state_referenced_locally */
	let exampleText = $state((initial?.example ?? []).join('\n'));
	/* svelte-ignore state_referenced_locally */
	let editorialText = $state((initial?.editorialNote ?? []).join('\n'));
	/* svelte-ignore state_referenced_locally */
	let notationText = $state((initial?.notation ?? []).join('\n'));
	/* svelte-ignore state_referenced_locally */
	let schemeIri = $state(initial?.schemeIri ?? '');
	/* svelte-ignore state_referenced_locally */
	let topConcept = $state(initial?.topConcept ?? false);
	/* svelte-ignore state_referenced_locally */
	let source = $state(initial?.source ?? '');
	/* svelte-ignore state_referenced_locally */
	let authority = $state(initial?.authority ?? '');
	/* svelte-ignore state_referenced_locally */
	let authorityIri = $state(initial?.authorityIri ?? '');
	/** The plain text an older concept has instead of a link. */
	/* svelte-ignore state_referenced_locally */
	const legacyAuthority = initial && !initial.authorityIri ? initial.authority : '';

	/** The units to choose from, always including the one this concept already links to. */
	const units = $derived(
		initial?.authorityIri && !businessUnits.some((u) => u.iri === initial.authorityIri)
			? [...businessUnits, { iri: initial.authorityIri, label: initial.authority }]
			: businessUnits
	);

	let errors = $state<string[]>([]);
	let saveError = $state<string | null>(null);
	let busy = $state(false);
	let newLang = $state('');
	let langError = $state<string | null>(null);
	let confirmRemove = $state(false);

	const tab = $derived(tabs[activeIndex]);
	const tabName = (t: Tab) => t.lang || 'No language';

	const similar = $derived(findSimilarConcepts(tab.pref, existing, { ignoreIri: initial?.iri }));
	const byIri = $derived(new Map(existing.map((c) => [c.iri, c])));

	function parseLines(text: string, lang: string): LangText[] {
		return text
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((t) => ({ text: t, lang }));
	}

	const single = (text: string, lang: string): LangText[] => (text.trim() ? [{ text: text.trim(), lang }] : []);

	function draftOf(list: Tab[]): ConceptDraft {
		return {
			prefLabels: list.flatMap((t) => single(t.pref, t.lang.trim())),
			altLabels: list.flatMap((t) => parseLines(t.alt, t.lang.trim())),
			hiddenLabels: list.flatMap((t) => parseLines(t.hidden, t.lang.trim())),
			definitions: list.flatMap((t) => single(t.definition, t.lang.trim())),
			scopeNotes: list.flatMap((t) => single(t.scopeNote, t.lang.trim())),
			notation: notationText.split('\n').map((n) => n.trim()).filter(Boolean),
			example: exampleText.split('\n').map((n) => n.trim()).filter(Boolean),
			editorialNote: editorialText.split('\n').map((n) => n.trim()).filter(Boolean),
			disambiguation: disambiguation.trim(),
			schemeIri,
			topConcept,
			status: initial?.status ?? 'proposed',
			source: source.trim(),
			...resolveAuthorityInput({ text: authority, iri: authorityIri, units, legacy: legacyAuthority }),
			replacedBy: initial?.replacedBy ?? '',
			deprecationReason: initial?.deprecationReason ?? ''
		};
	}

	const toDraft = () => draftOf(tabs);

	/** What is wrong inside one language alone (a missing preferred label is a concept-level problem). */
	function tabProblems(t: Tab): string[] {
		const slice: ConceptDraft = { ...draftOf([t]), status: 'proposed', topConcept: false };
		return validateConceptDraft(slice).filter((m) => m !== 'A preferred label is required');
	}

	const problemTabs = $derived(errors.length ? tabs.map((t) => tabProblems(t).length > 0) : tabs.map(() => false));

	/** Concept-level messages as they are; a message that comes from one language names it. */
	function named(message: string): string {
		if (tabs.length < 2) return message;
		const langs = tabs.filter((t) => tabProblems(t).includes(message)).map(tabName);
		return langs.length ? `${message} (${langs.join(', ')})` : message;
	}

	function select(index: number) {
		activeIndex = index;
		confirmRemove = false;
	}

	function onTabKey(event: KeyboardEvent, index: number) {
		const last = tabs.length - 1;
		const next =
			event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
			: event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
			: event.key === 'Home' ? 0
			: event.key === 'End' ? last
			: -1;
		if (next < 0) return;
		event.preventDefault();
		select(next);
		queueMicrotask(() => document.getElementById(`lang-tab-${next}`)?.focus());
	}

	function addLanguage() {
		const tag = newLang.trim().toLowerCase();
		if (!tag) {
			langError = 'Enter a language tag, for example "de"';
			return;
		}
		if (!isValidLangTag(tag)) {
			langError = `Invalid language tag "${tag}"`;
			return;
		}
		if (tabs.some((t) => sameLang(t.lang, tag))) {
			langError = `Language "${tag}" is already there`;
			return;
		}
		tabs.push(emptyTab(tag));
		langError = null;
		newLang = '';
		select(tabs.length - 1);
	}

	function removeLanguage() {
		tabs.splice(activeIndex, 1);
		confirmRemove = false;
		activeIndex = Math.min(activeIndex, tabs.length - 1);
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const draft = toDraft();
		errors = validateConceptDraft(draft);
		saveError = null;
		if (errors.length) {
			const bad = tabs.findIndex((t) => tabProblems(t).length > 0);
			if (bad >= 0) select(bad);
			return;
		}
		busy = true;
		try {
			await onSave(draft);
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	async function addAsAlternative(iri: string) {
		busy = true;
		saveError = null;
		try {
			await onAddAlternative(iri, tab.pref.trim(), tab.lang.trim());
		} catch (e) {
			saveError = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<div class="lang-strip" role="tablist" aria-label="Languages">
		{#each tabs as t, i (t.lang)}
			<button
				type="button"
				role="tab"
				id="lang-tab-{i}"
				class="lang-tab"
				class:problem={problemTabs[i]}
				aria-selected={i === activeIndex}
				aria-controls="lang-panel"
				tabindex={i === activeIndex ? 0 : -1}
				onclick={() => select(i)}
				onkeydown={(e) => onTabKey(e, i)}
			>
				{tabName(t)}{#if problemTabs[i]}<span class="marker" title="This language has an error">!</span>{/if}
			</button>
		{/each}
	</div>
	<div class="add-language">
		<label>
			New language tag
			<input type="text" list="concept-form-langs" bind:value={newLang} placeholder="de" size="8" onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLanguage(); } }} />
		</label>
		<datalist id="concept-form-langs">
			{#each COMMON_LANG_TAGS as code (code)}<option value={code}></option>{/each}
		</datalist>
		<button type="button" class="secondary" onclick={addLanguage}>+ Add language</button>
	</div>
	{#if langError}<p class="error" role="alert">{langError}</p>{/if}

	<div role="tabpanel" id="lang-panel" aria-labelledby="lang-tab-{activeIndex}" class="panel">
		<label>
			Preferred label
			<input type="text" bind:value={tabs[activeIndex].pref} placeholder="e.g. Customer" />
		</label>
		{#if similar.length}
			<div class="similar" role="status">
				<p>Similar concept{similar.length > 1 ? 's' : ''} already in the vocabulary. Reuse {similar.length > 1 ? 'one' : 'it'} instead of adding a duplicate:</p>
				<ul>
					{#each similar as match (match.iri)}
						<li>
							<strong>{byIri.get(match.iri) ? conceptTitle(byIri.get(match.iri)!) : match.iri}</strong>
							<span class="hint">{match.match} {match.via} label "{match.label}"</span>
							{#if tab.pref.trim()}
								<button type="button" class="link" disabled={busy} onclick={() => addAsAlternative(match.iri)}>Add as alternative label</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<label>
			Alternative labels (one per line)
			<textarea bind:value={tabs[activeIndex].alt} rows="2" placeholder="Synonyms, abbreviations"></textarea>
		</label>
		<label>
			Hidden labels (one per line)
			<textarea bind:value={tabs[activeIndex].hidden} rows="2" placeholder="Misspellings and retired terms, found by search but not shown"></textarea>
		</label>
		<div class="field">
			<label>
				Definition
				<textarea bind:value={tabs[activeIndex].definition} rows="3"></textarea>
			</label>
			<span class="hint">Say what kind of thing it is, then what sets it apart (genus and differentia): "A party (genus) that buys goods or services (differentia)."</span>
		</div>
		<div class="field">
			<label>
				Scope note
				<textarea bind:value={tabs[activeIndex].scopeNote} rows="2"></textarea>
			</label>
			{#if disambiguation.trim() && !tab.scopeNote.trim()}
				<span class="hint prompt">Add a scope note that tells this meaning apart from the other meanings of the term.</span>
			{/if}
		</div>
		{#if confirmRemove}
			<p class="confirm" role="alert">
				Remove {tabName(tab)} and every text written in it?
				<button type="button" class="secondary" onclick={removeLanguage}>Remove {tabName(tab)}</button>
				<button type="button" class="secondary" onclick={() => (confirmRemove = false)}>Keep</button>
			</p>
		{:else}
			<button type="button" class="link remove-language" disabled={tabs.length < 2} onclick={() => (confirmRemove = true)}>Remove language</button>
		{/if}
	</div>

	<label>
		Disambiguation
		<input type="text" bind:value={disambiguation} placeholder="Only for homonyms, e.g. finance" />
	</label>
	<label>
		Examples (one per line)
		<textarea bind:value={exampleText} rows="2" placeholder="How the term is used in practice"></textarea>
	</label>
	<div class="field">
		<label>
			Editorial notes (internal, one per line)
			<textarea bind:value={editorialText} rows="2"></textarea>
		</label>
		<span class="hint">Working notes for editors. They are not shown on read-only pages and are left out of exports unless you choose to include them.</span>
	</div>
	{#if memberOf.length}
		<p class="hint">
			<strong>In collections</strong>
			{#each memberOf as c, i (c.iri)}{#if i > 0}, {/if}<span>{c.prefLabels[0]?.text ?? c.iri}</span>{/each}
		</p>
	{/if}
	<label>
		Notation (one per line)
		<textarea bind:value={notationText} rows="2" placeholder="Legacy or system codes, e.g. a spreadsheet ID"></textarea>
	</label>
	<label>
		Scheme
		<select bind:value={schemeIri}>
			<option value="">(none)</option>
			{#each schemes as scheme (scheme.iri)}
				<option value={scheme.iri}>{schemeDisplayName(scheme)}</option>
			{/each}
		</select>
	</label>
	<label class="checkbox-label">
		<input type="checkbox" bind:checked={topConcept} />
		Top concept
	</label>
	<label>
		Source
		<input type="text" bind:value={source} placeholder="Where the definition comes from" />
	</label>
	<AuthorityPicker {units} bind:text={authority} bind:iri={authorityIri} legacy={legacyAuthority} />

	{#each errors as message (message)}
		<p class="error" role="alert">{named(message)}</p>
	{/each}
	<RationaleField bind:value={rationale} />
	{#if saveError}
		<p class="error" role="alert">{saveError}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
		<button type="submit" class="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input[type='text'],
	textarea,
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
	}

	.lang-strip {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border);
	}

	.lang-tab {
		background: transparent;
		border: 1px solid transparent;
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		color: var(--color-text-muted);
	}

	.lang-tab[aria-selected='true'] {
		border-color: var(--color-border);
		color: var(--color-text);
		font-weight: 600;
	}

	.lang-tab.problem,
	.marker {
		color: var(--color-error);
	}

	.marker {
		margin-left: 0.3rem;
		font-weight: 700;
	}

	.add-language {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.remove-language {
		align-self: flex-start;
		margin-left: 0;
	}

	.hint {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	.prompt {
		color: var(--color-accent);
	}

	.similar {
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		font-size: 0.85rem;
	}

	.similar ul {
		list-style: none;
		margin: 0.4rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.link {
		background: none;
		border: none;
		color: var(--color-accent);
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
		margin-left: 0.5rem;
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
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
