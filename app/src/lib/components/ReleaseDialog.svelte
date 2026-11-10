<script lang="ts">
	/** Content of the release dialog (ontology-pipeline STORY-333): reads the change log since the last release,
	 *  suggests the semantic-version bump, composes release notes and confirms. The suggestion and the notes
	 *  are starting points: both can be changed. The page writes the version and the release entry. */
	import type { ChangeLogItem } from '#lib/services/change-log.js';
	import { validateGovernance } from '#lib/services/governance.js';
	import { composeReleaseNotes, nextVersion, suggestBump, type Bump } from '#lib/services/release.js';

	interface Props {
		/** The changes since the last release. */
		entries: ChangeLogItem[];
		currentVersion: string;
		onConfirm: (release: { version: string; notes: string }) => Promise<void>;
		onCancel: () => void;
	}

	let { entries, currentVersion, onConfirm, onCancel }: Props = $props();

	const suggestion = $derived(suggestBump(entries));
	// Overrides are `null` until the user types, so a changed bump still updates version and notes.
	let chosenBump = $state<Bump | null>(null);
	let versionOverride = $state<string | null>(null);
	let notesOverride = $state<string | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const bump = $derived(chosenBump ?? suggestion.bump ?? 'patch');
	const version = $derived(versionOverride ?? nextVersion(currentVersion, bump));
	const notes = $derived(notesOverride ?? composeReleaseNotes(version, entries));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const problems = validateGovernance({ steward: '', authority: '', maturity: '', version });
		if (problems.length || !version.trim()) {
			error = problems[0] ?? 'The version must have three numbers, like 1.0.0';
			return;
		}
		error = null;
		busy = true;
		try {
			await onConfirm({ version: version.trim(), notes });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}
</script>

{#if entries.length === 0}
	<p>Nothing to release: the change log has no entries since the last release.</p>
	<div class="actions"><button type="button" onclick={onCancel}>Close</button></div>
{:else}
	<form onsubmit={submit} novalidate>
		<p class="hint">
			Current version: {currentVersion || 'not set'}. {entries.length} change{entries.length === 1 ? '' : 's'} since the last release. Suggested: {suggestion.bump}
			(major: removed or renamed class, changed domain or range, new disjointness; minor: additions; patch: labels and comments).
		</p>
		<label>
			Version bump
			<select value={bump} onchange={(e) => { chosenBump = e.currentTarget.value as Bump; versionOverride = null; notesOverride = null; }}>
				<option value="patch">patch</option>
				<option value="minor">minor</option>
				<option value="major">major</option>
			</select>
		</label>
		<label>
			New version
			<input type="text" value={version} oninput={(e) => { versionOverride = e.currentTarget.value; notesOverride = null; }} />
		</label>
		<label>
			Release notes
			<textarea rows="10" value={notes} oninput={(e) => (notesOverride = e.currentTarget.value)}></textarea>
		</label>
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
		<div class="actions">
			<button type="button" class="secondary" onclick={onCancel} disabled={busy}>Cancel</button>
			<button type="submit" class="primary" disabled={busy}>{busy ? 'Releasing…' : 'Release'}</button>
		</div>
	</form>
{/if}

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	input,
	select,
	textarea {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}

	textarea {
		font-family: inherit;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		margin: 0;
	}

	.error {
		color: var(--color-error);
		font-size: 0.85rem;
		margin: 0;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		border: 1px solid var(--color-border);
		background: transparent;
		color: var(--color-text);
		cursor: pointer;
	}

	.primary {
		background: var(--color-accent);
		border-color: var(--color-accent);
		color: #fff;
	}
</style>
