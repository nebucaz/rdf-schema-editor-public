<script lang="ts">
	/**
	 * STORY-194: "Export CSV" for the current workbench query. Runs the whole query in chunks via
	 * `exportAllRows` (not just the visible page), then downloads it client-side. Reports progress and,
	 * when the row cap cut the file short, says so.
	 */
	import type { BuilderSchema } from '$lib/services/query-builder-schema';
	import type { QueryModel } from '$lib/services/query-model';
	import { EXPORT_ROW_CAP, exportAllRows, exportFileName } from '$lib/services/query-export';
	import { readableQueryError } from '$lib/services/query-results';
	import { sparqlConnector } from '$lib/services/sparql-connector';
	import { toCsv } from '$lib/utils/csv';

	interface Props {
		model: QueryModel;
		schema: BuilderSchema;
		/** Saved-query name (STORY-195) used for the file name, when there is one. */
		queryName?: string | null;
		disabled?: boolean;
	}

	let { model, schema, queryName = null, disabled = false }: Props = $props();

	let busy = $state(false);
	let progress = $state(0);
	let rawIris = $state(false);
	let error = $state<string | null>(null);
	let truncated = $state(false);

	function download(text: string, fileName: string) {
		const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	async function run() {
		busy = true;
		error = null;
		truncated = false;
		progress = 0;
		try {
			const result = await exportAllRows(model, schema, sparqlConnector, {
				rawIris,
				onProgress: (n) => (progress = n)
			});
			download(toCsv(result.headers, result.rows), exportFileName(queryName));
			truncated = result.truncated;
		} catch (e) {
			error = readableQueryError(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="export">
	<button type="button" disabled={disabled || busy} onclick={run}>
		{busy ? `Exporting… ${progress.toLocaleString()} rows` : 'Export CSV'}
	</button>
	<label>
		<input type="checkbox" bind:checked={rawIris} disabled={busy} />
		Export IRIs instead of names
	</label>
	{#if truncated}
		<span class="notice" role="status" data-testid="export-truncated">
			The file was limited to the first {EXPORT_ROW_CAP.toLocaleString()} rows — narrow the query to export the rest.
		</span>
	{/if}
	{#if error}<span class="error" role="alert">{error}</span>{/if}
</div>

<style>
	.export {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-danger, #b00020);
	}
</style>
