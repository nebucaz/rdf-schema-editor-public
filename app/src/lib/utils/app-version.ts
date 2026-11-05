/**
 * The app version shown in the Settings menu: `version` from `package.json`, plus `git describe` in
 * brackets (`1.0.9 (v1.0.9-3-ga1b2c3d)`), injected at build time by `vite.config.ts` (`define`), like
 * the deployment paths in `urls.ts`. A clean build of exactly the tag `v<version>` shows the bare version.
 */

/** Combines `package.json`'s version with `git describe --tags --always --dirty` output. */
export function formatAppVersion(version: string, gitDescribe: string | undefined): string {
	const described = gitDescribe?.trim();
	if (!described || described === `v${version}`) return version;
	return `${version} (${described})`;
}

/** `'dev'` when the build-time constant is missing or empty. */
export function resolveAppVersion(injected: string | undefined): string {
	return injected ? injected : 'dev';
}

export const APP_VERSION = resolveAppVersion(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined);
