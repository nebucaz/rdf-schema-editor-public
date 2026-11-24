<script lang="ts">
	/** The `<dd>` rows of a definition-list entry holding several texts (definitions, scope notes). Not keyed:
	 *  two texts can be identical (same text, different language tag), and the list is read-only, so a text
	 *  must never be used as the key (`each_key_duplicate`). */
	interface Props {
		texts: string[];
		/** Shown as one `<dd>` when `texts` is empty; omit to render nothing. */
		empty?: string;
	}
	let { texts, empty }: Props = $props();
</script>

{#each texts as text}<dd>{text}</dd>{:else}{#if empty !== undefined}<dd>{empty}</dd>{/if}{/each}
