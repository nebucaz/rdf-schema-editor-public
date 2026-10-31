/**
 * The only place that knows the deployment paths (spec/deployment-req STORY-006): build backend
 * URLs with `apiUrl`, in-app links/`goto` targets with `appUrl`, share links with `absoluteAppUrl`
 * and compare a browser pathname with route paths via `stripBase`. Never write a bare `/api/...`
 * literal or an absolute `/workbench` href elsewhere — `urls-guard.spec.ts` enforces it.
 */

export interface DeploymentPaths {
	/** `''` or `/a/b` — where the SPA is served (`kit.paths.base`). */
	appBasePath: string;
	/** `''` or `/a/b` — the backend is reached at `<apiPrefix>/api`. */
	apiPrefix: string;
}

function requireLeadingSlash(path: string): string {
	if (!path.startsWith('/')) throw new Error(`URL path must have a leading "/": ${JSON.stringify(path)}`);
	return path;
}

/** Builds the helper set for explicit settings (the default instance below uses the build-time ones). */
export function createUrls({ appBasePath, apiPrefix }: DeploymentPaths) {
	/** `/me` → `<apiPrefix>/api/me`. */
	const apiUrl = (path: string): string => `${apiPrefix}/api${requireLeadingSlash(path)}`;

	/** `/workbench?m=x` → `<appBasePath>/workbench?m=x`. */
	const appUrl = (path: string): string => `${appBasePath}${requireLeadingSlash(path)}`;

	/** `https://host` + `/reports/Id` → `https://host<appBasePath>/reports/Id`. */
	const absoluteAppUrl = (origin: string, path: string): string => `${origin}${appUrl(path)}`;

	/** `<appBasePath>/workbench` → `/workbench`; a pathname outside the base is returned unchanged. */
	const stripBase = (pathname: string): string => {
		if (!appBasePath) return pathname;
		if (pathname === appBasePath) return '/';
		return pathname.startsWith(`${appBasePath}/`) ? pathname.slice(appBasePath.length) : pathname;
	};

	return { apiUrl, appUrl, absoluteAppUrl, stripBase };
}

export const { apiUrl, appUrl, absoluteAppUrl, stripBase } = createUrls({
	appBasePath: __APP_BASE_PATH__,
	apiPrefix: __API_PREFIX__
});
