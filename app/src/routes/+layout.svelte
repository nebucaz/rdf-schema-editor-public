<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();
</script>

<ModeWatcher defaultMode="system" />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>RDF Schema Editor</title>
</svelte:head>

<div class="app-container">
	<header class="app-header">
		<span class="app-title">RDF Schema Editor</span>
		<ThemeToggle />
	</header>
	<main class="app-main">
		{@render children()}
	</main>
</div>

<style>
	.app-container {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: var(--nav-height);
		padding: 0 1.5rem;
		border-bottom: 1px solid var(--color-border);
		background: var(--color-bg-secondary);
	}

	.app-title {
		font-weight: 600;
	}

	.app-main {
		flex: 1;
		overflow: auto;
	}
</style>
