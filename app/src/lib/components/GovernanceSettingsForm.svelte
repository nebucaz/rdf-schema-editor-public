<script lang="ts">
	/** Steward, authority, maturity and version of the core namespace (ontology-pipeline STORY-331). */
	import { MATURITY_LEVELS, validateGovernance, type Governance } from '#lib/services/governance.js';

	interface Props {
		initial: Governance;
		onSave: (g: Governance) => Promise<void>;
	}

	let { initial, onSave }: Props = $props();

	/* svelte-ignore state_referenced_locally */
	let steward = $state(initial.steward);
	/* svelte-ignore state_referenced_locally */
	let authority = $state(initial.authority);
	/* svelte-ignore state_referenced_locally */
	let maturity = $state<Governance['maturity']>(initial.maturity);
	/* svelte-ignore state_referenced_locally */
	let version = $state(initial.version);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const MATURITY_LABEL = { poc: 'POC', pilot: 'Pilot', production: 'Production' } as const;

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const g: Governance = { steward: steward.trim(), authority: authority.trim(), maturity, version: version.trim() };
		const problems = validateGovernance(g);
		if (problems.length) {
			error = problems[0];
			return;
		}
		error = null;
		busy = true;
		try {
			await onSave(g);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	<p class="hint">Names are recorded, not enforced: the app has no permissions, so they say who is accountable, not who is allowed.</p>
	<label>Steward<input type="text" bind:value={steward} /></label>
	<label>Authority<input type="text" bind:value={authority} /></label>
	<label>
		Maturity
		<select bind:value={maturity}>
			<option value="">(not set)</option>
			{#each MATURITY_LEVELS as level (level)}
				<option value={level}>{MATURITY_LABEL[level]}</option>
			{/each}
		</select>
	</label>
	<label>Version<input type="text" bind:value={version} placeholder="1.0.0" /></label>
	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}
	<button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
</form>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		max-width: 26rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input,
	select {
		font-size: 0.9rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.4rem 0.55rem;
	}

	button {
		align-self: flex-start;
		padding: 0.45rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--color-accent);
		background: var(--color-accent);
		color: #fff;
		cursor: pointer;
	}

	.hint {
		font-size: 0.82rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
		margin: 0;
	}
</style>
