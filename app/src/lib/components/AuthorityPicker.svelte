<script lang="ts">
	/** Who holds authority: a business unit, chosen with a typeahead like the entity picker of the schema editor. While a
	 *  name is typed the existing units that match are listed; picking one links to it, a name equal to one links to it
	 *  too, and a new name is created with the save. An old plain-text value (`legacy`) is shown as it is and stays text
	 *  until it is changed. */
	import { findBusinessUnit, suggestBusinessUnits, type BusinessUnit } from '#lib/services/business-unit.js';

	interface Props {
		units: BusinessUnit[];
		text: string;
		iri: string;
		/** The plain text the concept had before authorities were nodes. */
		legacy?: string;
		label?: string;
	}

	let { units, text = $bindable(), iri = $bindable(), legacy = '', label = 'Authority' }: Props = $props();

	const listId = `authority-units-${Math.random().toString(36).slice(2, 8)}`;
	let open = $state(false);
	let activeIndex = $state(-1);

	const typed = $derived(text.trim().replace(/\s+/g, ' '));
	const exact = $derived(findBusinessUnit(units, typed));
	const linked = $derived(exact ?? (iri ? units.find((u) => u.iri === iri) : undefined));
	const rows = $derived(iri ? [] : suggestBusinessUnits(units, typed, 50));
	const isNew = $derived(!!typed && !linked && typed.toLowerCase() !== legacy.trim().toLowerCase());

	function onInput(event: Event) {
		text = (event.currentTarget as HTMLInputElement).value;
		iri = '';
		open = true;
		activeIndex = -1;
	}

	function pick(unit: BusinessUnit) {
		text = unit.label;
		iri = unit.iri;
		open = false;
		activeIndex = -1;
	}

	function onKeydown(event: KeyboardEvent) {
		if (!open || rows.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = (activeIndex + 1) % rows.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = activeIndex <= 0 ? rows.length - 1 : activeIndex - 1;
		} else if (event.key === 'Enter' && activeIndex >= 0) {
			event.preventDefault();
			pick(rows[activeIndex]);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="authority">
	<label>
		{label}
		<input
			type="text"
			value={text}
			placeholder="A business unit, e.g. Data Office"
			autocomplete="off"
			role="combobox"
			aria-expanded={open && rows.length > 0}
			aria-controls={listId}
			aria-autocomplete="list"
			oninput={onInput}
			onkeydown={onKeydown}
			onblur={() => (open = false)}
		/>
	</label>
	{#if open && rows.length > 0}
		<ul class="picker" id={listId} role="listbox">
			{#each rows as unit, i (unit.iri)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- mousedown is prevented so the input keeps focus (and does not blur-close) before the click lands -->
				<li
					role="option"
					aria-selected={i === activeIndex}
					class:active={i === activeIndex}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => pick(unit)}
				>
					{unit.label}
				</li>
			{/each}
		</ul>
	{/if}
	{#if linked}
		<span class="hint">Linked to the business unit "{linked.label}".</span>
	{:else if isNew}
		<span class="hint">A new business unit "{typed}" will be created when you save.</span>
	{/if}
</div>

<style>
	.authority {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	.picker {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 12rem;
		overflow-y: auto;
		border: 1px solid var(--color-border);
		border-radius: 4px;
	}

	.picker li {
		padding: 0.3rem 0.5rem;
		cursor: pointer;
	}

	.picker li.active,
	.picker li:hover {
		background: var(--color-hover);
	}

	.hint {
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}
</style>
