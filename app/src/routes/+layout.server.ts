import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { readUserIdentity } from '$lib/server/user-identity';

/**
 * Exposes only the user's `sub` and display name to the browser (query-workbench STORY-179). The raw
 * `USER_AUTH_TOKEN` and its other claims stay on the server. `null` = no/invalid/expired token:
 * browsing and querying still work, identity-requiring actions are disabled by the UI.
 */
export const load: LayoutServerLoad = () => ({
	user: readUserIdentity(env.USER_AUTH_TOKEN)
});
