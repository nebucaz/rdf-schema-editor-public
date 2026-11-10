<script lang="ts">
	/** Why a change is made, for the change log (ontology-pipeline STORY-331). Optional; shared by the forms
	 *  that edit the model so the label and wording are the same everywhere. */
	interface Props {
		value?: string;
	}

	let { value = $bindable('') }: Props = $props();
</script>

<label>
	Rationale <span class="hint">(goes into the change log)</span>
	<textarea bind:value rows="2" placeholder="Which question or decision needs this change?"></textarea>
</label>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}

	.hint {
		font-size: 0.75rem;
	}

	textarea {
		font-size: 0.95rem;
		color: var(--color-text);
		background: var(--color-bg);
		border: 1px solid var(--color-border);
		border-radius: 6px;
		padding: 0.5rem 0.65rem;
	}
</style>
