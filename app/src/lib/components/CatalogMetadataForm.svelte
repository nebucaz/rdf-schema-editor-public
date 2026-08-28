<script lang="ts">
	/**
	 * Per-entity catalog metadata entry (data-catalog Story 011): `dct:publisher`/`dct:license`
	 * overrides (blank means "use the namespace default" — Story 008's generation engine already
	 * pre-fills from that default at first-generation time, so leaving these blank here just means
	 * "don't override that seed") and the one `dcat:Distribution` block's
	 * `dct:format`/`dcat:mediaType`/`dcat:accessURL`. Writes directly to GraphDB (not through the
	 * Catalog tab's draft/Turtle text) via dedicated connector methods, so this form and a hand-edit
	 * of the Turtle draft can't clobber each other mid-session — `onSaved` tells the parent to
	 * re-fetch the Catalog tab's Turtle so the edit becomes visible there too. Deliberately
	 * write-only/unprefilled: the Turtle editor right below already shows the current values in
	 * context, so this form doesn't duplicate that state.
	 */
	import { sparqlConnector } from '$lib/services/sparql-connector';
	import { isWellFormedIri } from '$lib/utils/iri';

	interface Props {
		classIri: string;
		namespaceBaseIri: string;
		onSaved: () => void;
	}

	let { classIri, namespaceBaseIri, onSaved }: Props = $props();

	let publisher = $state('');
	let license = $state('');
	let format = $state('');
	let mediaType = $state('');
	let accessURL = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);

	function validateIriField(value: string, label: string): string | null {
		if (value.trim() && !isWellFormedIri(value.trim())) {
			return `${label} must be a well-formed IRI`;
		}
		return null;
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		error =
			validateIriField(license, 'License') ??
			validateIriField(format, 'Format') ??
			validateIriField(mediaType, 'Media type') ??
			validateIriField(accessURL, 'Access URL');
		if (error) return;

		saving = true;
		try {
			await Promise.all([
				sparqlConnector.setCatalogPublisher(classIri, publisher.trim() || null, namespaceBaseIri),
				sparqlConnector.setCatalogLicense(classIri, license.trim() || null, namespaceBaseIri),
				sparqlConnector.setCatalogDistribution(
					classIri,
					{ format: format.trim() || null, mediaType: mediaType.trim() || null, accessURL: accessURL.trim() || null },
					namespaceBaseIri
				)
			]);
			publisher = '';
			license = '';
			format = '';
			mediaType = '';
			accessURL = '';
			onSaved();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save catalog metadata';
		} finally {
			saving = false;
		}
	}
</script>

<form class="catalog-metadata-form" onsubmit={handleSubmit}>
	<div class="fields">
		<label>
			Publisher override
			<input type="text" bind:value={publisher} placeholder="Leave blank to use the namespace default" />
		</label>
		<label>
			License override
			<input type="text" bind:value={license} placeholder="Leave blank to use the namespace default" />
		</label>
		<label>
			Distribution format
			<input type="text" bind:value={format} placeholder="IANA media-type IRI" />
		</label>
		<label>
			Distribution media type
			<input type="text" bind:value={mediaType} placeholder="IANA media-type IRI" />
		</label>
		<label>
			Distribution access URL
			<input type="text" bind:value={accessURL} placeholder="Access URL" />
		</label>
	</div>
	{#if error}
		<p class="error">{error}</p>
	{/if}
	<button type="submit" class="primary" disabled={saving}>{saving ? 'Saving…' : 'Save catalog metadata'}</button>
</form>

<style>
	.catalog-metadata-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-bg);
	}

	.fields {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.78rem;
		color: var(--color-text-muted);
	}

	input {
		font-size: 0.85rem;
		color: var(--color-text);
		background: var(--color-bg-secondary);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	.error {
		margin: 0;
		color: var(--color-error);
		font-size: 0.8rem;
	}

	button {
		align-self: flex-start;
		padding: 0.4rem 0.9rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}

	.primary {
		background: var(--color-accent);
		color: #fff;
	}

	.primary:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
