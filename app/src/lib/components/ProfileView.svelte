<script lang="ts">
	import type { SessionUser } from '$lib/services/session-user';

	interface Props {
		user: SessionUser;
	}

	let { user }: Props = $props();
</script>

<dl class="profile">
	<dt>Name</dt>
	<dd>{user.displayName || '—'}</dd>
	<dt>Email</dt>
	<dd>{user.email || '—'}</dd>
	<dt>Department</dt>
	<dd>{user.department || '—'}</dd>
	<dt>Groups</dt>
	<dd>
		{#if user.groups.length > 0}
			<ul>
				{#each user.groups as group (group)}
					<li>{group}</li>
				{/each}
			</ul>
		{:else}
			—
		{/if}
	</dd>
</dl>

<style>
	.profile {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 1.5rem;
		margin: 0;
	}

	dt {
		color: var(--color-text-muted);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	ul {
		margin: 0;
		padding-left: 1.1rem;
	}
</style>
