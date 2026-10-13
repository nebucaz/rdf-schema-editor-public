<script lang="ts">
	/**
	 * workbench-columns (STORY-239): the "Add column" dialog. With no query yet it asks for a start
	 * class (namespace dropdown narrowing a class dropdown) and lists that class' Label/IRI/properties
	 * as checkboxes; Save creates the query with the ticked columns in one step. Nothing is applied
	 * until Save, so Cancel/Escape/backdrop leave the model untouched.
	 *
	 * STORY-240: once a query exists the same dialog is in 'extend' mode. Step 1 is the searchable list
	 * of `reachableSteps` (grouped by from-class, disabled ones greyed with their reason) or an
	 * existing group; step 2 is the chosen class' columns. Save applies one hop plus columns, or just
	 * columns for an existing group.
	 */
	import { untrack } from 'svelte';
	import Modal from './Modal.svelte';
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { FetchedNamespace } from '$lib/services/sparql-connector';
	import {
		columnChoices,
		filterSteps,
		nearestPath,
		reachableSteps,
		startClassOptions,
		type ColumnChoice,
		type ReachableStep
	} from '$lib/services/query-add-column';
	import { buildColumnGroups } from '$lib/services/query-column-groups';
	import type { QueryModel } from '$lib/services/query-model';
	import { extractLocalName } from '$lib/utils/iri';
	import { propertyHints } from '$lib/utils/query-class-picker';

	interface Props {
		isOpen: boolean;
		schema: BuilderSchema;
		namespaces: FetchedNamespace[];
		/** The query being extended; `null` = nothing started yet (first-class mode). */
		model?: QueryModel | null;
		/** Creates the query: start class and the ticked columns (in listed order). */
		onStart: (classIri: string, picks: ColumnChoice[]) => void;
		/** Extend mode: add the hop `step` describes with the ticked columns under it. */
		onStep?: (step: ReachableStep, picks: ColumnChoice[]) => void;
		/**
		 * Extend mode: change an existing group's columns (`null` = the root). `picks` are newly ticked
		 * columns, `removeColumnIds` the ids of columns that were unticked.
		 */
		onGroup?: (hopId: string | null, picks: ColumnChoice[], removeColumnIds: string[]) => void;
		/** Opens straight on a group's column list: `'group:root'` or `'group:<hopId>'`. */
		initialTarget?: string | null;
		onClose: () => void;
	}

	let {
		isOpen,
		schema,
		namespaces,
		model = null,
		onStart,
		onStep,
		onGroup,
		initialTarget = null,
		onClose
	}: Props = $props();

	let namespaceBaseIri = $state('');
	let classIri = $state('');
	let ticked = $state<Set<number>>(new Set());

	const namespaceOptions = $derived(
		namespaces
			.filter((ns) => [...schema.classes.values()].some((c) => c.namespaceBaseIri === ns.baseIri))
			.sort((a, b) => a.prefix.localeCompare(b.prefix))
	);
	const options = $derived(startClassOptions(schema, namespaces, namespaceBaseIri || null));

	// Extend mode.
	const steps = $derived(reachableSteps(model, schema));
	const groups = $derived(model ? buildColumnGroups(model, schema) : []);
	let search = $state('');
	/** `step:<key>` or `group:<hopId|root>`; `null` until the analyst picks one. */
	let target = $state<string | null>(null);
	const stepKey = (s: ReachableStep) =>
		`step:${s.fromHopId ?? 'root'}|${s.direction}|${s.relationshipIri}|${s.targetClassIri}`;
	const shownSteps = $derived(filterSteps(steps, search));
	const stepGroups = $derived(
		groups
			.map((g) => ({ group: g, steps: shownSteps.filter((s) => s.fromHopId === g.hopId) }))
			.filter((x) => x.steps.length > 0)
	);
	const chosenStep = $derived(steps.find((s) => stepKey(s) === target));
	const chosenGroup = $derived(
		target?.startsWith('group:') ? groups.find((g) => (g.hopId ?? 'root') === target!.slice(6)) : undefined
	);
	/** Source → id of the group's existing columns; they open ticked and unticking removes them. */
	const existingBySource = $derived(
		chosenGroup
			? new Map(chosenGroup.columns.map((c) => [JSON.stringify(c.column.source), c.column.id]))
			: new Map<string, string>()
	);

	const cls = $derived(
		model
			? schema.classes.get(chosenStep?.targetClassIri ?? chosenGroup?.classIri ?? '')
			: classIri
				? schema.classes.get(classIri)
				: undefined
	);
	const choices = $derived(cls ? columnChoices(cls) : []);
	const isExisting = (c: ColumnChoice) => existingBySource.has(JSON.stringify(c.source));
	/** Choice indices already present in a group, for opening its dialog pre-ticked. */
	function existingIndices(key: string): Set<number> {
		const g = groups.find((x) => `group:${x.hopId ?? 'root'}` === key);
		const c = g ? schema.classes.get(g.classIri) : undefined;
		if (!g || !c) return new Set();
		const have = new Set(g.columns.map((x) => JSON.stringify(x.column.source)));
		return new Set(
			columnChoices(c).flatMap((choice, i) => (have.has(JSON.stringify(choice.source)) ? [i] : []))
		);
	}
	/** What Save would change in group mode: newly ticked picks and the columns unticked. */
	const groupChange = $derived.by(() => {
		if (!chosenGroup) return null;
		const picks = choices.filter((c, i) => ticked.has(i) && !isExisting(c));
		const removeIds = choices.flatMap((c, i) =>
			!ticked.has(i) && isExisting(c) ? [existingBySource.get(JSON.stringify(c.source))!] : []
		);
		return { picks, removeIds };
	});
	const canSave = $derived(
		!cls ? false : groupChange ? groupChange.picks.length + groupChange.removeIds.length > 0 : ticked.size > 0
	);

	const hint = $derived.by(() => {
		if (!model) return null;
		const needle = search.trim().toLowerCase();
		if (steps.length > 0 && (!needle || shownSteps.length > 0)) return null;
		const base = 'Only classes one relationship away from a class already in the query are listed.';
		if (!needle) return base;
		const hit = [...schema.classes.values()].find((c) => c.label.toLowerCase().includes(needle));
		const path = hit ? nearestPath(model, schema, hit.iri) : null;
		return path ? `${base} Nearest path to ${hit!.label}: ${path.join(' › ')}.` : base;
	});

	// Reset whenever the dialog opens so a cancelled attempt never leaks into the next one.
	$effect(() => {
		if (isOpen) {
			namespaceBaseIri = '';
			classIri = '';
			ticked = new Set();
			search = '';
			target = initialTarget;
			const t = initialTarget;
			if (t && model) ticked = untrack(() => existingIndices(t));
		}
	});

	function toggle(i: number) {
		const next = new Set(ticked);
		if (next.has(i)) next.delete(i);
		else next.add(i);
		ticked = next;
	}

	function pick(key: string) {
		target = key;
		ticked = key.startsWith('group:') ? existingIndices(key) : new Set();
	}

	function save() {
		if (!canSave || !cls) return;
		if (chosenGroup && groupChange) {
			onGroup?.(chosenGroup.hopId, groupChange.picks, groupChange.removeIds);
			return;
		}
		const picks = choices.filter((c, i) => ticked.has(i));
		if (picks.length === 0) return;
		if (!model) onStart(cls.iri, picks);
		else if (chosenStep) onStep?.(chosenStep, picks);
	}
</script>

<Modal {isOpen} title={initialTarget ? 'Edit columns' : 'Add column'} {onClose} maxWidth="640px">
	<div class="add-column" data-testid="add-column-modal">
		{#if model}
			<div class="steps" data-testid="add-column-steps">
				<input
					type="search"
					placeholder="Search relationships and classes…"
					aria-label="Search relationships and classes"
					bind:value={search}
					data-testid="add-column-search"
				/>
				{#each stepGroups as { group, steps: groupSteps } (group.hopId ?? 'root')}
					<fieldset>
						<legend>From {group.label}{group.viaLabel ? ` (${group.viaLabel})` : ''}</legend>
						<ul>
							{#each groupSteps as s (stepKey(s))}
								<li class:disabled={s.disabledReason !== null}>
									<label>
										<input
											type="radio"
											name="add-column-target"
											checked={target === stepKey(s)}
											disabled={s.disabledReason !== null}
											onchange={() => pick(stepKey(s))}
										/>
										<span class="name">
											{s.direction === 'inverse' ? `← ${s.label}` : `${s.label} →`}
											{s.targetLabel}
										</span>
									</label>
									{#if s.disabledReason}<span class="meta">{s.disabledReason}</span>{/if}
								</li>
							{/each}
						</ul>
					</fieldset>
				{/each}
				{#if hint}
					<p class="hint" role="status" data-testid="add-column-hint">{hint}</p>
				{/if}
				<fieldset data-testid="add-column-existing">
					<legend>Edit the columns of an existing group</legend>
					<ul>
						{#each groups as g (g.hopId ?? 'root')}
							<li>
								<label>
									<input
										type="radio"
										name="add-column-target"
										checked={target === `group:${g.hopId ?? 'root'}`}
										onchange={() => pick(`group:${g.hopId ?? 'root'}`)}
									/>
									<span class="name">{g.viaLabel ? `${g.viaLabel} ` : ''}{g.label}</span>
								</label>
							</li>
						{/each}
					</ul>
				</fieldset>
			</div>
		{:else}
		<div class="pickers">
			<select
				aria-label="Filter by namespace"
				bind:value={namespaceBaseIri}
				onchange={() => {
					if (classIri && !options.some((o) => o.iri === classIri)) {
						classIri = '';
						ticked = new Set();
					}
				}}
				data-testid="add-column-namespace"
			>
				<option value="">Any namespace</option>
				{#each namespaceOptions as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix}</option>
				{/each}
			</select>
			<select
				aria-label="Start the query from a class"
				bind:value={classIri}
				onchange={() => (ticked = new Set())}
				data-testid="add-column-class"
			>
				<option value="">Select a class…</option>
				{#each options as o (o.iri)}
					<option value={o.iri}>{o.label}</option>
				{/each}
			</select>
		</div>
		{/if}

		{#if cls}
			<fieldset data-testid="add-column-properties">
				<legend>Properties of {cls.label}</legend>
				<ul>
					{#each choices as choice, i (i)}
						<li>
							<label>
								<input
									type="checkbox"
									checked={ticked.has(i)}
									onchange={() => toggle(i)}
								/>
								<span class="name">{choice.name}</span>
							</label>
							{#if choice.datatype}<span class="meta">{extractLocalName(choice.datatype)}</span>{/if}
							{#if choice.enumeration}
								<span class="tag" title="Restricted to a fixed list of values">enumeration</span>
							{/if}
							{#if typeof choice.source === 'object'}
								{@const prop = cls.properties.find((p) => p.iri === (choice.source as { propertyIri: string }).propertyIri)}
								{#if prop}
									{#each propertyHints(prop) as hint (hint)}<span class="tag">{hint}</span>{/each}
								{/if}
							{/if}
						</li>
					{/each}
				</ul>
			</fieldset>
		{:else}
			<p class="hint">
				{model ? 'Choose a relationship to follow, or a group to add properties to.' : 'Choose the class this query starts from.'}
			</p>
		{/if}

		<div class="actions">
			<button type="button" onclick={onClose} data-testid="add-column-cancel">Cancel</button>
			<button
				type="button"
				class="primary"
				disabled={!canSave}
				onclick={save}
				data-testid="add-column-save"
			>
				Save
			</button>
		</div>
	</div>
</Modal>

<style>
	.add-column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.pickers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	select {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
		font-size: 0.85rem;
	}
	fieldset {
		margin: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}
	li {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
	.meta,
	.tag,
	.hint {
		font-size: 0.75rem;
		opacity: 0.7;
	}
	.hint {
		margin: 0;
		font-size: 0.85rem;
	}
	.tag {
		border: 1px solid var(--color-border);
		border-radius: 4px;
		padding: 0 0.25rem;
	}
	.steps {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.steps input[type='search'] {
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
		color: var(--color-text);
	}
	li.disabled {
		opacity: 0.6;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
