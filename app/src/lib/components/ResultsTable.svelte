<script module lang="ts">
	import { XSD_NAMESPACE, extractLocalName } from '$lib/utils/iri';
	import type { SparqlBinding, SparqlSelectResults } from '$lib/services/sparql-connector';

	/** Client-side render cap (plan ADR "Large result sets") — no `LIMIT` is injected into the
	 *  user's query, so an unbounded result set is instead capped at render time. */
	export const MAX_RENDERED_ROWS = 1000;

	function cellText(binding: SparqlBinding[string] | undefined): string {
		if (!binding) return '';
		if (binding.type === 'bnode') return `_:${binding.value}`;
		return binding.value;
	}

	function datatypeSuffix(binding: SparqlBinding[string] | undefined): string | null {
		if (!binding || binding.type !== 'literal') return null;
		if (binding['xml:lang']) return `@${binding['xml:lang']}`;
		if (binding.datatype && binding.datatype !== `${XSD_NAMESPACE}string`) {
			return binding.datatype.startsWith(XSD_NAMESPACE)
				? `^^xsd:${extractLocalName(binding.datatype)}`
				: `^^${binding.datatype}`;
		}
		return null;
	}
</script>

<script lang="ts">
	interface Props {
		results: SparqlSelectResults;
	}

	let { results }: Props = $props();

	let rows = $derived(results.results.bindings.slice(0, MAX_RENDERED_ROWS));
	let truncated = $derived(results.results.bindings.length > MAX_RENDERED_ROWS);
</script>

{#if results.results.bindings.length === 0}
	<p class="empty">No results</p>
{:else}
	<div class="table-wrap">
		<table>
			<thead>
				<tr>
					{#each results.head.vars as varName (varName)}
						<th>{varName}</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as row, i (i)}
					<tr>
						{#each results.head.vars as varName (varName)}
							{@const binding = row[varName]}
							<td class:bnode={binding?.type === 'bnode'} class:uri={binding?.type === 'uri'}>
								{cellText(binding)}{#if datatypeSuffix(binding)}<span class="suffix"
										>{datatypeSuffix(binding)}</span
									>{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if truncated}
		<p class="truncation-notice">
			Showing {MAX_RENDERED_ROWS.toLocaleString()} of {results.results.bindings.length.toLocaleString()}
			rows — add your own <code>LIMIT</code> to see a different slice.
		</p>
	{/if}
{/if}

<style>
	.table-wrap {
		overflow: auto;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		max-height: 50vh;
	}

	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.85rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.4rem 0.65rem;
		border-bottom: 1px solid var(--color-border);
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		background: var(--color-bg-secondary);
		color: var(--color-text-muted);
		font-weight: 600;
	}

	tbody tr:last-child td {
		border-bottom: none;
	}

	td.uri {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		color: var(--color-text);
	}

	td.bnode {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
		color: var(--color-text-muted);
	}

	.suffix {
		color: var(--color-text-muted);
		font-size: 0.8em;
		margin-left: 0.15rem;
	}

	.empty,
	.truncation-notice {
		font-size: 0.85rem;
		color: var(--color-text-muted);
		margin: 0.5rem 0 0;
	}

	.truncation-notice code {
		font-family: 'SF Mono', Menlo, Consolas, monospace;
	}
</style>
