/**
 * Build-time deployment paths (spec/deployment-req STORY-005): `APP_BASE_PATH` (the SPA lives at
 * `<host><base>/`) and `API_PREFIX` (the backend is reached at `<host><prefix>/api`). Both are read
 * by `vite.config.ts`, so this module must stay free of browser and `$app` imports.
 */

// One or more `/segment`s of unreserved URL characters; `.`/`..` segments are rejected separately.
const SEGMENTS = /^(\/[A-Za-z0-9._~-]+)+$/;

/**
 * Normalises a raw env value to `''` (unset) or `/a/b` (leading slash, no trailing slash). Throws,
 * naming `name`, on anything that is not a plain path (scheme, `//`, `.`/`..`, query, whitespace…).
 */
export function normalizeBasePath(raw: string | undefined, name: string): '' | `/${string}` {
	const trimmed = (raw ?? '').trim();
	if (trimmed === '' || trimmed === '/') return '';
	const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
	const path = withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
	const hasDotSegment = path.split('/').some((segment) => segment === '.' || segment === '..');
	if (!SEGMENTS.test(path) || hasDotSegment) {
		throw new Error(
			`${name}=${JSON.stringify(raw)} is not a valid path; use something like "/path" (letters, digits, . _ ~ - and / only)`
		);
	}
	return path as `/${string}`;
}

/** The dev-proxy key: browser requests to `<prefix>/api/...` go to the Go backend. */
export const apiProxyKey = (apiPrefix: string): string => `${apiPrefix}/api`;

/** Strips `<prefix>/api` so the backend sees its own prefix-free routes (`/me`, `/sparql`, ...). */
export const apiProxyRewrite =
	(apiPrefix: string) =>
	(path: string): string => {
		const key = apiProxyKey(apiPrefix);
		return path.startsWith(key) ? path.slice(key.length) : path;
	};
