<script lang="ts">
	import type { FetchedNamespace } from '$lib/services/sparql-connector';

	interface EntityOption {
		iri: string;
		name: string;
	}

	interface LinkRow {
		propName: string;
		targetClassIri: string;
		required: boolean;
		maxOne: boolean;
	}

	interface Props {
		entityOptions: EntityOption[];
		namespaceOptions?: FetchedNamespace[];
		initialNamespaceBaseIri?: string;
		onSubmit: (name: string, description: string, links: LinkRow[], namespaceBaseIri: string) => Promise<void>;
		onCancel: () => void;
	}

	let {
		entityOptions,
		namespaceOptions = [],
		initialNamespaceBaseIri = '',
		onSubmit,
		onCancel
	}: Props = $props();

	const defaultTarget = entityOptions[0]?.iri ?? '';

	let name = $state('');
	let description = $state('');
	let namespaceBaseIri = $state(initialNamespaceBaseIri);
	let links = $state<LinkRow[]>([
		{ propName: '', targetClassIri: defaultTarget, required: true, maxOne: true },
		{ propName: '', targetClassIri: defaultTarget, required: true, maxOne: true }
	]);
	let error = $state<string | null>(null);
	let submitting = $state(false);

	function addLink() {
		links = [...links, { propName: '', targetClassIri: defaultTarget, required: false, maxOne: true }];
	}

	function removeLink(index: number) {
		links = links.filter((_, i) => i !== index);
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			error = 'Name must not be empty';
			return;
		}
		if (links.length < 2) {
			error = 'An attributed relationship needs at least two links';
			return;
		}
		if (links.some((l) => !l.propName.trim() || !l.targetClassIri)) {
			error = 'Every link needs a name and a target entity';
			return;
		}
		error = null;
		submitting = true;
		try {
			await onSubmit(
				name.trim(),
				description.trim(),
				links.map((l) => ({ ...l, propName: l.propName.trim() })),
				namespaceBaseIri
			);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
		} finally {
			submitting = false;
		}
	}
</script>

<form onsubmit={handleSubmit}>
	<label>
		Name
		<input type="text" bind:value={name} placeholder="e.g. EmploymentAssignment" />
	</label>
	<label>
		Description
		<textarea bind:value={description} placeholder="Optional description" rows="2"></textarea>
	</label>
	{#if namespaceOptions.length > 0}
		<label>
			Namespace
			<select bind:value={namespaceBaseIri}>
				{#each namespaceOptions as ns (ns.baseIri)}
					<option value={ns.baseIri}>{ns.prefix}</option>
				{/each}
			</select>
		</label>
	{/if}

	<div class="links-section">
		<span class="links-title">Links to related entities</span>
		{#each links as link, i (i)}
			<div class="link-row">
				<input type="text" bind:value={link.propName} placeholder="e.g. employee" class="link-name" />
				<select bind:value={link.targetClassIri} class="link-target">
					{#each entityOptions as option (option.iri)}
						<option value={option.iri}>{option.name}</option>
					{/each}
				</select>
				<label class="checkbox small">
					<input type="checkbox" bind:checked={link.required} />
					req
				</label>
				<label class="checkbox small">
					<input type="checkbox" bind:checked={link.maxOne} />
					single
				</label>
				<button
					type="button"
					class="remove-link"
					onclick={() => removeLink(i)}
					disabled={links.length <= 2}
					aria-label={`Remove link ${i + 1}`}
					title="Remove link"
				>
					×
				</button>
			</div>
		{/each}
		<button type="button" class="add-link" onclick={addLink}>+ Add link</button>
	</div>

	{#if error}
		<p class="error">{error}</p>
	{/if}
	<div class="actions">
		<button type="button" class="secondary" onclick={onCancel} disabled={submitting}>Cancel</button>
		<button type="submit" class="primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create'}</button>
	</div>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
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

	.links-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.links-title {
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.link-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.link-name {
		flex: 1;
		min-width: 0;
	}

	.link-target {
		flex: 1;
		min-width: 0;
	}

	.checkbox.small {
		flex-direction: row;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.remove-link {
		width: 24px;
		height: 24px;
		border-radius: 6px;
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text-muted);
		font-size: 1rem;
		line-height: 1;
	}

	.remove-link:hover:not(:disabled) {
		background: var(--color-hover);
		color: var(--color-error);
	}

	.remove-link:disabled {
		opacity: 0.4;
	}

	.add-link {
		align-self: flex-start;
		font-size: 0.85rem;
		color: var(--color-accent);
		padding: 0.25rem 0;
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

	.actions button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.9rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--color-border);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-hover);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
