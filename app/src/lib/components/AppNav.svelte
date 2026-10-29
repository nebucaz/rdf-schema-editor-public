<script lang="ts">
	import { onMount } from 'svelte';
	import type { RouteView } from '$lib/utils/route-views';
	import DropdownMenu from './DropdownMenu.svelte';

	interface Props {
		routeView: RouteView;
	}

	let { routeView }: Props = $props();

	/** `/reports/<id>` has no tab of its own: every flag below is false there, so no link is active.
	 *  `title` carries the full area name, since the visible labels are one word. */
	const links = $derived([
		{ href: '/identities', label: 'Identities', title: 'Identities', active: routeView.isIdentitiesView },
		{ href: '/', label: 'Schema', title: 'Schema Editor', active: routeView.isCanvasView },
		{ href: '/workbench', label: 'Report', title: 'Query Workbench', active: routeView.isWorkbenchView },
		{ href: '/validation', label: 'Validation', title: 'Validation Report', active: routeView.isValidationView }
	]);
	const activeLink = $derived(links.find((l) => l.active));

	let container = $state<HTMLElement>();
	let fullStrip = $state<HTMLElement>();
	let nav = $state<HTMLElement>();
	let collapsed = $state(false);
	/** Width of the collapsed content (active tab + menu button). The container may shrink to this and
	 *  no further, so the header actions are pushed along instead of being overlapped by the tab. */
	let collapsedMinWidth = $state(0);

	/** Collapse when the container is narrower than the full strip. The full strip is always rendered
	 *  (hidden, out of flow) purely to be measured, so expanding again never depends on the collapsed DOM. */
	function measure() {
		if (container && fullStrip) collapsed = container.clientWidth < fullStrip.scrollWidth;
	}

	$effect(() => {
		collapsedMinWidth = collapsed && nav ? nav.scrollWidth : 0;
	});

	onMount(() => {
		measure();
		if (typeof ResizeObserver === 'undefined') return;
		const observer = new ResizeObserver(measure);
		if (container) observer.observe(container);
		return () => observer.disconnect();
	});
</script>

<div class="nav-container" bind:this={container} style:min-width={collapsedMinWidth ? `${collapsedMinWidth}px` : undefined}>
	<div class="measure" bind:this={fullStrip} aria-hidden="true">
		{#each links as link (link.href)}
			<span class="nav-link">{link.label}</span>
		{/each}
	</div>

	<nav class="app-nav" aria-label="Main" bind:this={nav}>
		{#if collapsed}
			<DropdownMenu label="Navigation" align="left">
				{#snippet icon()}
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M3 6h18" />
						<path d="M3 12h18" />
						<path d="M3 18h18" />
					</svg>
				{/snippet}
				{#snippet children()}
					{#each links.filter((l) => !l.active) as link (link.href)}
						<a href={link.href} role="menuitem" class="menu-item nav-menu-link" title={link.title}>{link.label}</a>
					{/each}
				{/snippet}
			</DropdownMenu>
			{#if activeLink}
				<a
					href={activeLink.href}
					class="nav-link"
					title={activeLink.title}
					aria-current="page"
					onclick={(e) => e.preventDefault()}
				>
					{activeLink.label}
				</a>
			{/if}
		{:else}
			{#each links as link (link.href)}
				<a
					href={link.href}
					class="nav-link"
					title={link.title}
					aria-current={link.active ? 'page' : undefined}
					onclick={(e) => {
						if (link.active) e.preventDefault();
					}}
				>
					{link.label}
				</a>
			{/each}
		{/if}
	</nav>
</div>

<style>
	.nav-container {
		position: relative;
		display: flex;
		flex: 1;
		min-width: 0;
		align-self: stretch;
	}

	.measure {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
		display: flex;
		gap: 0.25rem;
		white-space: nowrap;
	}

	.app-nav {
		display: flex;
		align-items: stretch;
		gap: 0.25rem;
	}

	.nav-link {
		display: flex;
		align-items: center;
		padding: 0.375rem 0.75rem;
		border-bottom: 2px solid transparent;
		color: var(--color-text);
		font-size: 0.875rem;
		text-decoration: none;
		white-space: nowrap;
		transition: background var(--transition), border-color var(--transition);
	}

	.nav-link:hover {
		background: var(--color-hover);
	}

	.nav-link[aria-current='page'] {
		border-bottom-color: var(--color-accent);
		font-weight: 600;
		cursor: default;
	}

	/* The menu toggle sits before the active tab, vertically centred in the stretched strip. */
	.app-nav :global(.dropdown-wrapper) {
		align-self: center;
	}

	.nav-menu-link {
		text-decoration: none;
		box-sizing: border-box;
	}
</style>
