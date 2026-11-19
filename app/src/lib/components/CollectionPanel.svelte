<script lang="ts">
	/** SKOS collections of the vocabulary (skos-support STORY-410): create, rename, fill, reorder and delete.
	 *  A collection groups concepts for navigation and facets and implies no hierarchy. Presentational:
	 *  every change goes out through a callback and the page reloads. Deleting follows refuse-then-force. */
	import { planEnumeratedClass } from '#lib/services/concept-to-class.js';
	import ConceptPicker from './ConceptPicker.svelte';
	import { conceptTitle, type Concept, type LangText } from '#lib/services/skos-concept.js';
	import { validateCollectionDraft, type CollectionDraft, type SkosCollection } from '#lib/services/skos-collection.js';

	interface Props {
		collections: SkosCollection[];
		concepts: Concept[];
		onCreate: (draft: CollectionDraft) => Promise<void>;
		onSaveLabels: (iri: string, prefLabels: LangText[]) => Promise<void>;
		onAddMember: (iri: string, member: string) => Promise<void>;
		onRemoveMember: (iri: string, member: string) => Promise<void>;
		onReorder: (iri: string, members: string[]) => Promise<void>;
		/** Without `force` a collection with members is refused and its members come back. */
		onDelete: (iri: string, force: boolean) => Promise<{ deleted: boolean; members: string[] }>;
		/** Namespaces a class can be created in (the vocabulary namespace left out by the page). */
		namespaces?: { baseIri: string; prefix: string }[];
		/** Turns a collection into an enumerated class; resolves to the message to show. Without it no button is shown. */
		onCreateEnumeration?: (collectionIri: string, namespaceBaseIri: string) => Promise<string>;
		/** Show only this collection (the others stay available as targets); the Collections tab selects one. */
		only?: string | null;
		/** The create form and the hint under it; the Collections tab has its own. */
		showCreate?: boolean;
	}

	let { collections, concepts, onCreate, onSaveLabels, onAddMember, onRemoveMember, onReorder, onDelete, namespaces = [], onCreateEnumeration, only = null, showCreate = true }: Props = $props();

	let enumerating = $state<string | null>(null);
	let enumNamespace = $state('');
	let enumMessage = $state<string | null>(null);
	let enumError = $state<string | null>(null);

	const enumPlan = $derived.by(() => {
		const col = collections.find((x) => x.iri === enumerating);
		return col ? planEnumeratedClass(col, collections, concepts) : null;
	});

	function startEnumeration(iri: string) {
		enumerating = enumerating === iri ? null : iri;
		enumMessage = null;
		enumError = null;
		if (!namespaces.some((n) => n.baseIri === enumNamespace)) enumNamespace = namespaces[0]?.baseIri ?? '';
	}

	async function createEnumeration() {
		if (!enumerating || !onCreateEnumeration) return;
		enumError = null;
		try {
			enumMessage = await onCreateEnumeration(enumerating, enumNamespace);
		} catch (e) {
			enumError = e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	let newLabel = $state('');
	let newOrdered = $state(false);
	let errors = $state<string[]>([]);
	let error = $state<string | null>(null);
	let confirming = $state<{ iri: string; members: number } | null>(null);
	let labelEdits = $state<Record<string, string>>({});
	let dragFrom = $state<{ iri: string; index: number } | null>(null);

	const localName = (iri: string) => iri.split(/[#/]/).pop() ?? iri;
	const titleOfCollection = (c: SkosCollection) => c.prefLabels.find((l) => l.text.trim())?.text ?? localName(c.iri);
	function titleOf(iri: string): string {
		const concept = concepts.find((c) => c.iri === iri);
		if (concept) return conceptTitle(concept);
		const collection = collections.find((c) => c.iri === iri);
		return collection ? titleOfCollection(collection) : localName(iri);
	}

	async function run(action: () => Promise<void>) {
		error = null;
		try {
			await action();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		}
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		const draft: CollectionDraft = { prefLabels: newLabel.trim() ? [{ text: newLabel.trim(), lang: 'en' }] : [], ordered: newOrdered };
		errors = validateCollectionDraft(draft);
		if (errors.length) return;
		await run(async () => {
			await onCreate(draft);
			newLabel = '';
			newOrdered = false;
		});
	}

	const labelValue = (c: SkosCollection) => labelEdits[c.iri] ?? c.prefLabels[0]?.text ?? '';

	function move(c: SkosCollection, from: number, to: number) {
		if (to < 0 || to >= c.members.length || from === to) return Promise.resolve();
		const members = [...c.members];
		const [item] = members.splice(from, 1);
		members.splice(to, 0, item);
		return run(() => onReorder(c.iri, members));
	}

	async function remove(c: SkosCollection, force: boolean) {
		await run(async () => {
			const result = await onDelete(c.iri, force);
			confirming = result.deleted ? null : { iri: c.iri, members: result.members.length };
		});
	}
</script>

<section class="collections" aria-label="Collections">
	{#if showCreate}
	<form onsubmit={create} class="create">
		<label>
			Collection label
			<input type="text" bind:value={newLabel} placeholder="e.g. Regions" />
		</label>
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={newOrdered} />
			Ordered collection
		</label>
		<button type="submit">Add collection</button>
		{#each errors as message (message)}<p class="error" role="alert">{message}</p>{/each}
	</form>
	<p class="hint">A collection groups concepts for menus and facets. It implies no hierarchy: use broader and narrower for that.</p>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#each only ? collections.filter((x) => x.iri === only) : collections as c (c.iri)}
		{@const title = titleOfCollection(c)}
		<article class="collection">
			<h3>{title}</h3>
			<span class="badge">{c.ordered ? 'Ordered' : 'Unordered'}</span>
			<div class="row">
				<input
					type="text"
					aria-label="Label of {title}"
					value={labelValue(c)}
					oninput={(e) => (labelEdits[c.iri] = e.currentTarget.value)}
				/>
				<button
					type="button"
					aria-label="Save label of {title}"
					onclick={() => run(() => onSaveLabels(c.iri, [{ text: labelValue(c).trim(), lang: c.prefLabels[0]?.lang ?? 'en' }]))}
				>Save label</button>
			</div>
			{#if c.members.length}
				<ul class="members">
					{#each c.members as m, i (m)}
						<li
							draggable={c.ordered}
							ondragstart={() => (dragFrom = { iri: c.iri, index: i })}
							ondragover={(e) => c.ordered && e.preventDefault()}
							ondrop={() => {
								if (dragFrom?.iri === c.iri) void move(c, dragFrom.index, i);
								dragFrom = null;
							}}
						>
							<span>{titleOf(m)}</span>
							{#if c.ordered}
								{#if i > 0}<button type="button" class="link" aria-label="Move {titleOf(m)} up in {title}" onclick={() => move(c, i, i - 1)}>↑</button>{/if}
								{#if i < c.members.length - 1}<button type="button" class="link" aria-label="Move {titleOf(m)} down in {title}" onclick={() => move(c, i, i + 1)}>↓</button>{/if}
							{/if}
							<button type="button" class="link" aria-label="Remove {titleOf(m)} from {title}" onclick={() => run(() => onRemoveMember(c.iri, m))}>Remove</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="hint">No members yet.</p>
			{/if}
			<ConceptPicker
				label="Add a concept"
				{concepts}
				value=""
				onChange={(iri) => iri && run(() => onAddMember(c.iri, iri))}
			/>
			<label>
				Add a collection
				<select
					aria-label="Add a collection to {title}"
					value=""
					onchange={(e) => {
						const target = e.currentTarget.value;
						e.currentTarget.value = '';
						if (target) void run(() => onAddMember(c.iri, target));
					}}
				>
					<option value="">(choose)</option>
					{#each collections.filter((o) => o.iri !== c.iri) as o (o.iri)}
						<option value={o.iri}>{titleOfCollection(o)}</option>
					{/each}
				</select>
			</label>
			<div class="row">
				{#if onCreateEnumeration}
					<button type="button" aria-label="Create enumerated class from {title}" onclick={() => startEnumeration(c.iri)}>Create enumerated class…</button>
				{/if}
				<button type="button" class="danger" aria-label="Delete {title}" onclick={() => remove(c, false)}>Delete</button>
			</div>
			{#if enumerating === c.iri && enumPlan}
				<div class="confirm">
					{#if enumPlan.error}
						<p role="alert">{enumPlan.error}</p>
					{:else}
						<p>Creates the class "{enumPlan.className}" with {enumPlan.members.length} {enumPlan.members.length === 1 ? 'member' : 'members'}, one per concept. Only labels are written; the members are not linked to the concepts.</p>
					{/if}
					<label>
						Namespace
						<select bind:value={enumNamespace}>
							{#each namespaces as n (n.baseIri)}<option value={n.baseIri}>{n.prefix || n.baseIri}</option>{/each}
						</select>
					</label>
					<button type="button" disabled={!!enumPlan.error || !enumNamespace} onclick={createEnumeration}>Create class</button>
					{#if enumError}<p role="alert">{enumError}</p>{/if}
					{#if enumMessage}<p role="status">{enumMessage}</p>{/if}
				</div>
			{/if}
			{#if confirming?.iri === c.iri}
				<div class="confirm" role="alert">
					<p>{title} has {confirming.members} {confirming.members === 1 ? 'member' : 'members'}. Deleting it keeps the concepts and removes only the grouping.</p>
					<button type="button" class="danger" onclick={() => remove(c, true)}>Delete anyway</button>
					<button type="button" onclick={() => (confirming = null)}>Cancel</button>
				</div>
			{/if}
		</article>
	{:else}
		<p class="hint">No collections yet.</p>
	{/each}
</section>

<style>
	.collections,
	.create,
	.collection {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.collection {
		border: 1px solid var(--color-border);
		border-radius: 8px;
		padding: 0.75rem;
	}

	h3 {
		margin: 0;
		font-size: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.checkbox-label {
		flex-direction: row;
		align-items: center;
	}

	input[type='text'],
	select {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.6rem;
	}

	.row {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.row input {
		flex: 1;
	}

	.members {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.members li {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.members li span {
		flex: 1;
	}

	.badge,
	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
	}

	.link {
		background: none;
		color: var(--color-accent);
		padding: 0 0.25rem;
	}

	.danger {
		color: var(--color-error);
	}

	.confirm {
		border: 1px solid var(--color-error);
		border-radius: 6px;
		padding: 0.5rem;
	}
</style>
