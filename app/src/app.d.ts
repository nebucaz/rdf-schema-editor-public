// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Build-time constants injected by vite.config.ts (`define`) from APP_BASE_PATH / API_PREFIX —
// normalised, `''` or `/a/b`. Use `lib/utils/urls.ts`, not these, from application code.
declare global {
	const __APP_BASE_PATH__: string;
	const __API_PREFIX__: string;
	/** `version` from package.json; use `APP_VERSION` from `lib/utils/app-version.ts`. */
	const __APP_VERSION__: string;
}

export {};
