<script lang="ts">
	/** Test host for documentation-context.spec.ts: provides the opener (when given) and reads it back. */
	import { provideOpenDocumentation, useOpenDocumentation, type OpenDocumentation } from './documentation-context.js';

	let { open }: { open: OpenDocumentation | undefined } = $props();

	// The host is a fixed shape for the test, so reading the prop once is intended.
	// svelte-ignore state_referenced_locally
	if (open) provideOpenDocumentation(open);
	const provided = useOpenDocumentation();
</script>

<span data-testid="provided">{provided ? 'opener' : 'none'}</span>
{#if provided}
	<button type="button" onclick={() => provided('guide-ontology')}>ask for guide</button>
{/if}
