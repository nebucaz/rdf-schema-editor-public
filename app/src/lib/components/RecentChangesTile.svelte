<script lang="ts">
	/** The Recent changes tile (spec/ontology-dashboard STORY-473): the latest change log entries. It loads lazily and
	 *  keeps a failure to itself. An entry links to its object only when the page can say where that object lives. */
	import type { ChangeLogItem } from '#lib/services/change-log.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		status: 'loading' | 'ready' | 'error';
		entries?: ChangeLogItem[];
		error?: string;
		/** Where the changed term (a concept, class or property IRI) can be looked at; `null` when nowhere. */
		linkFor?: (termIri: string) => string | null;
	}

	let { status, entries = [], error = '', linkFor = () => null }: Props = $props();

	const day = (at: string) => at.slice(0, 10);
</script>

{#if status === 'loading'}
	<p data-testid="changes-loading">Loading…</p>
{:else if status === 'error'}
	<p class="error" role="status" data-testid="changes-error">The change log could not be read{error ? `: ${error}` : ''}.</p>
{:else if entries.length === 0}
	<p data-testid="changes-none">No changes recorded yet.</p>
{:else}
	<ul>
		{#each entries as entry (entry.iri)}
			{@const href = entry.term ? linkFor(entry.term) : null}
			<li>
				<span class="when">{day(entry.changedAt)}</span>
				{#if entry.kind === 'release'}<strong>Release {entry.version}:</strong>{/if}
				{#if href}<a {href}>{entry.summary}</a>{:else}{entry.summary}{/if}
				<span class="by">{entry.changedBy}</span>
			</li>
		{/each}
	</ul>
{/if}
{#if status !== 'loading'}
	<p class="more"><a href={appUrl('/governance')}>Change log</a></p>
{/if}

<style>
	p {
		margin: 0 0 0.4rem;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-error);
	}
	ul {
		margin: 0 0 0.4rem;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
	}
	.when,
	.by {
		color: var(--color-text-muted);
		font-size: 0.8rem;
	}
	a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
