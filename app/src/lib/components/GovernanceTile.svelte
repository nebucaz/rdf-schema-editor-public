<script lang="ts">
	/** The Governance tile (spec/ontology-dashboard STORY-473): steward, authority, maturity, version and the open change
	 *  requests of the core namespace. It loads lazily, so it shows its own loading and failure states; a failure never
	 *  reaches the rest of the page. */
	import type { Governance } from '#lib/services/governance.js';
	import { appUrl } from '#lib/utils/urls.js';

	interface Props {
		status: 'loading' | 'ready' | 'error';
		/** `null`: no core vocabulary namespace. */
		governance?: Governance | null;
		/** `null` when the count could not be read. */
		openRequests?: number | null;
		error?: string;
	}

	let { status, governance = null, openRequests = null, error = '' }: Props = $props();

	const MATURITY: Record<string, string> = { poc: 'POC', pilot: 'Pilot', production: 'Production' };
	const text = (value: string) => value.trim() || 'Not set';
</script>

{#if status === 'loading'}
	<p data-testid="governance-loading">Loading…</p>
{:else if status === 'error'}
	<p class="error" role="status" data-testid="governance-error">Governance could not be read{error ? `: ${error}` : ''}.</p>
{:else if !governance}
	<p data-testid="governance-none">No core vocabulary namespace is set, so there is no steward or version yet.</p>
{:else}
	<dl>
		<div><dt>Steward</dt><dd data-testid="governance-steward">{text(governance.steward)}</dd></div>
		<div><dt>Authority</dt><dd data-testid="governance-authority">{text(governance.authority)}</dd></div>
		<div><dt>Maturity</dt><dd data-testid="governance-maturity">{governance.maturity ? MATURITY[governance.maturity] : 'Not set'}</dd></div>
		<div><dt>Version</dt><dd data-testid="governance-version">{text(governance.version)}</dd></div>
		<div><dt>Open change requests</dt><dd data-testid="governance-requests">{openRequests ?? 'Unknown'}</dd></div>
	</dl>
{/if}
{#if status !== 'loading'}
	<p class="more"><a href={appUrl('/governance')}>Governance</a></p>
{/if}

<style>
	p {
		margin: 0 0 0.4rem;
		font-size: 0.85rem;
	}
	.error {
		color: var(--color-error);
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.2rem 1rem;
		margin: 0 0 0.4rem;
		font-size: 0.85rem;
	}
	dl > div {
		display: contents;
	}
	dt {
		color: var(--color-text-muted);
	}
	dd {
		margin: 0;
	}
	a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
