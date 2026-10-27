<script lang="ts">
	import { devLogin } from '$lib/services/auth-client';

	interface Props {
		/** `devLoginEnabled` from `/api/config`; the login button never renders when false. */
		devLoginEnabled: boolean;
		/** Called after a successful login so the caller can re-run the layout load. */
		onSignedIn: () => void | Promise<void>;
		fetchFn?: typeof fetch;
	}

	let { devLoginEnabled, onSignedIn, fetchFn = fetch }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	async function login() {
		busy = true;
		error = null;
		const result = await devLogin(fetchFn);
		busy = false;
		if (result.ok) await onSignedIn();
		else error = result.message;
	}
</script>

<section class="sign-in-required">
	<h1>Sign in required</h1>
	<p>You need to be signed in to view or edit schemas and data.</p>
	{#if devLoginEnabled}
		<button type="button" class="login-btn" disabled={busy} onclick={login}>Login with user role</button>
		{#if error}
			<p class="login-error" role="alert">{error}</p>
		{/if}
	{:else}
		<p>Sign in through your company single sign-on, then reload this page.</p>
	{/if}
</section>

<style>
	.sign-in-required {
		max-width: 32rem;
		margin: 4rem auto;
		padding: 0 1rem;
		text-align: center;
	}
	.login-btn {
		margin-top: 1.5rem;
		padding: 0.5rem 1rem;
		border: 1px solid currentColor;
		border-radius: 4px;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.login-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.login-error {
		color: #c0392b;
	}
</style>
