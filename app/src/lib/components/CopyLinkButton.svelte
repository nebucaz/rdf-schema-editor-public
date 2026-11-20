<script lang="ts">
	/** Copies the absolute link of an app page (share icon + label). If the browser refuses the clipboard, the link is shown
	 *  in a read-only box to copy by hand. */
	import { absoluteAppUrl } from '#lib/utils/urls.js';

	interface Props {
		/** App path such as `/review/glossary`; the deployment base path is added. */
		path: string;
		label: string;
	}

	let { path, label }: Props = $props();

	let copied = $state(false);
	let manual = $state('');

	async function copy() {
		const link = absoluteAppUrl(window.location.origin, path);
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
			manual = '';
			setTimeout(() => (copied = false), 2500);
		} catch {
			manual = link;
		}
	}
</script>

<span class="copy-link">
	<button type="button" onclick={copy} aria-label={label} title={label}>
		<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
			<line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
		</svg>
		Share
	</button>
	{#if copied}<span class="hint" role="status">Link copied</span>{/if}
	{#if manual}<input type="text" readonly value={manual} aria-label="Link to copy" onfocus={(e) => e.currentTarget.select()} />{/if}
</span>

<style>
	.copy-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.hint {
		font-size: 0.8rem;
		color: var(--color-text-muted);
	}

	input {
		width: 18rem;
		font-size: 0.8rem;
	}
</style>
