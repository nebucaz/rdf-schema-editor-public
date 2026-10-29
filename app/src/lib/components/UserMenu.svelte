<script lang="ts">
	import DropdownMenu from './DropdownMenu.svelte';

	interface Props {
		user: { displayName: string };
		logoutEnabled: boolean;
		onProfile: () => void;
		onLogout: () => Promise<{ ok: true } | { ok: false; message: string }>;
	}

	let { user, logoutEnabled, onProfile, onLogout }: Props = $props();

	let logoutFailed = $state(false);

	async function handleLogout(close: () => void) {
		const result = await onLogout();
		logoutFailed = !result.ok;
		if (result.ok) close();
	}
</script>

<!-- The name is also in the aria-label: below the narrow breakpoint only the icon is visible. -->
<DropdownMenu label={`User menu — ${user.displayName}`} title={user.displayName}>
	{#snippet icon()}
		<span class="user-toggle">
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			</svg>
			<span class="user-name">{user.displayName}</span>
		</span>
	{/snippet}
	{#snippet children(close)}
		<button type="button" role="menuitem" class="menu-item" onclick={onProfile}>Profile</button>
		{#if logoutEnabled}
			<button
				type="button"
				role="menuitem"
				class="menu-item"
				onclick={(e) => {
					// Keep the menu open until the logout result is known, so a failure stays visible.
					e.stopPropagation();
					void handleLogout(close);
				}}
			>
				{logoutFailed ? 'Logout failed – retry' : 'Logout'}
			</button>
		{/if}
	{/snippet}
</DropdownMenu>

<style>
	.user-toggle {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.5rem;
	}

	.user-name {
		max-width: 14rem;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.875rem;
		white-space: nowrap;
	}

	@media (max-width: 600px) {
		.user-name {
			display: none;
		}
	}
</style>
