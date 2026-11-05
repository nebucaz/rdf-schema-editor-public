import { defineConfig, loadEnv } from 'vite';
import type { ViteUserConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };
import { formatAppVersion } from './src/lib/utils/app-version.ts';
import { apiProxyKey, apiProxyRewrite, normalizeBasePath } from './src/lib/utils/base-paths.ts';

function gitDescribe(): string | undefined {
	try {
		return execSync('git describe --tags --always --dirty --match "v*"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
	} catch {
		return undefined;
	}
}

export default defineConfig(({ mode }) => {
	// Dev-only: nginx is absent under `vite dev`, so the dev server plays its part — strips `/api` and
	// injects the service JWT. Read with loadEnv (not $env) so neither value can reach client code.
	const env = loadEnv(mode, process.cwd(), '');
	// Fall back to the pre-static-frontend names so an existing app/.env keeps working.
	const backendUrl = env.DEV_BACKEND_URL || env.BACKEND_URL || 'http://localhost:8090';
	const backendToken = env.DEV_BACKEND_AUTH_TOKEN || env.BACKEND_AUTH_TOKEN;
	// Build-time deployment paths (spec/deployment-req): the app under <host><base>/, the backend at
	// <host><prefix>/api. Not secrets — they are baked into the bundle via `define` below.
	const appBasePath = normalizeBasePath(env.APP_BASE_PATH, 'APP_BASE_PATH');
	const apiPrefix = normalizeBasePath(env.API_PREFIX, 'API_PREFIX');
	// `git describe` shown beside the version (tag, commits since, short hash, -dirty). APP_GIT_DESCRIBE (a
	// Docker build arg — the image build has no .git) wins; otherwise ask git; with neither, version only.
	const appGitDescribe = env.APP_GIT_DESCRIBE || gitDescribe();
	return {
		define: {
			__APP_BASE_PATH__: JSON.stringify(appBasePath),
			__API_PREFIX__: JSON.stringify(apiPrefix),
			__APP_VERSION__: JSON.stringify(formatAppVersion(pkg.version, appGitDescribe))
		},
		server: {
			proxy: {
				[apiProxyKey(apiPrefix)]: {
					target: backendUrl,
					// Keep the browser's Host so the backend's same-origin (CSRF) check sees Origin == Host.
					changeOrigin: false,
					rewrite: apiProxyRewrite(apiPrefix),
					headers: backendToken ? { Authorization: `Bearer ${backendToken}` } : {}
				}
			}
		},
		plugins: [
			sveltekit({
				// Kit options sit at the top level of the inline config (no `kit:` wrapper), like `adapter` below.
				paths: { base: appBasePath },
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Node-free deployment: static files only, served with an SPA fallback (spec/static-frontend).
				adapter: adapter({ fallback: 'index.html' })
			})
		],
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				},
				{
					// Component tests (STORY-247): jsdom + @testing-library/svelte, mocked connector calls only —
					// no live browser and no GraphDB. `browser` resolve condition so Svelte mounts client-side.
					extends: './vite.config.ts',
					resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
					test: {
						name: 'component',
						environment: 'jsdom',
						include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
						setupFiles: ['./vitest-component-setup.ts']
					}
				}
			]
		}
	} satisfies ViteUserConfig;
});
