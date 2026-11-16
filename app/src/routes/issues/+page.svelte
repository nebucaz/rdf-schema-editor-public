<script lang="ts">
	/** validation-issues-tracker STORY-388: dedicated `/issues` route — a thin wrapper around `IssuesView`. */
	import IssuesView from '#lib/components/IssuesView.svelte';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Validation Issues — RDF Schema Editor</title>
</svelte:head>

<div class="issues-page">
	<h1>Validation Issues</h1>
	<IssuesView currentUser={page.data.user?.sub ?? null} focusIssueId={page.url.searchParams.get('issue')} />
</div>

<style>
	.issues-page {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		gap: 1rem;
		box-sizing: border-box;
		overflow-y: auto;
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
	}
</style>
