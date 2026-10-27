import { defineConfig, loadEnv } from 'vite';
import type { ViteUserConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ mode }) => {
	// Dev-only: nginx is absent under `vite dev`, so the dev server plays its part — strips `/api` and
	// injects the service JWT. Read with loadEnv (not $env) so neither value can reach client code.
	const env = loadEnv(mode, process.cwd(), '');
	// Fall back to the pre-static-frontend names so an existing app/.env keeps working.
	const backendUrl = env.DEV_BACKEND_URL || env.BACKEND_URL || 'http://localhost:8090';
	const backendToken = env.DEV_BACKEND_AUTH_TOKEN || env.BACKEND_AUTH_TOKEN;
	return {
		server: {
			proxy: {
				'/api': {
					target: backendUrl,
					// Keep the browser's Host so the backend's same-origin (CSRF) check sees Origin == Host.
					changeOrigin: false,
					rewrite: (path) => path.replace(/^\/api/, ''),
					headers: backendToken ? { Authorization: `Bearer ${backendToken}` } : {}
				}
			}
		},
		plugins: [
			sveltekit({
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
