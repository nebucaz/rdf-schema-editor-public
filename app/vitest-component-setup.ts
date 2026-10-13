import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// With the `browser` resolve condition SvelteKit serves `$env/dynamic/public` from this global, which
// the real client populates at boot; an empty object makes config fall back to its defaults.
(globalThis as Record<string, unknown>).__sveltekit_dev = { env: {} };

afterEach(() => cleanup());
