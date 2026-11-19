<script lang="ts">
	import type { EntityConceptFieldVM } from './EntityNode.svelte';
	import { extractLocalName } from '#lib/utils/iri.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		field: EntityConceptFieldVM;
		/** The scheme's label, when known; the scheme's local name otherwise. */
		schemeName?: string;
		onEdit: (field: EntityConceptFieldVM) => void;
		onDelete: (field: EntityConceptFieldVM) => void;
	}

	let { field, schemeName, onEdit, onDelete }: Props = $props();
	const label = $derived(schemeName ?? extractLocalName(field.valueSchemeIri ?? ''));
</script>

<li class="concept-field">
	<span class="attr-name">{field.name}</span>
	<span
		class="attr-type"
		title={`${field.required ? 'Required (!)' : 'Optional (?)'}${field.repeatable ? ', repeatable ([])' : ', single-valued'}; value is a concept of the scheme ${label}`}
	>
		<span class="arrow">→</span>
		<a href={appUrl('/vocabulary')} class="scheme-link">{label}</a>{field.required ? '!' : '?'}{field.repeatable ? '[]' : ''}
	</span>
	{#if field.inheritedFrom}
		<span class="attr-inherited-from">from {field.inheritedFrom.className}</span>
	{:else}
		<span class="attr-actions">
			<button class="icon-button small" onclick={() => onEdit(field)} aria-label={`Edit ${field.name}`} title="Edit">
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
			</button>
			<button class="icon-button small" onclick={() => onDelete(field)} aria-label={`Delete ${field.name}`} title="Delete">
				<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
			</button>
		</span>
	{/if}
</li>

<style>
	.concept-field {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem;
		list-style: none;
	}

	.attr-name {
		font-weight: 500;
	}

	.attr-type {
		color: var(--color-text-muted);
		font-size: 11px;
		flex: 1;
	}

	.scheme-link {
		color: var(--color-accent);
		text-decoration: none;
	}

	.scheme-link:hover {
		text-decoration: underline;
	}

	.attr-inherited-from {
		color: var(--color-text-muted);
		font-size: 10px;
	}

	.attr-actions {
		display: flex;
		gap: 0.15rem;
	}

	.icon-button {
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: 4px;
	}

	.icon-button:hover {
		background: var(--color-hover);
	}
</style>
