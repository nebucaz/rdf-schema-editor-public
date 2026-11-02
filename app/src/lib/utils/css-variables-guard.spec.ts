import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec/loading-spinner STORY-264: a `var(--x)` whose `--x` is defined nowhere silently falls
 * back (e.g. `var(--color-surface, #fff)` was always white, even in dark mode). Every referenced custom
 * property must be defined in `app.css` or declared in the same component, in a `<style>` block, an
 * inline `style="--x: …"` or a `style:--x={…}` directive.
 */

/**
 * Variables set at runtime by something other than the component that reads them (a parent, a library).
 * Empty today: add a name here, with a reason, only when it genuinely cannot be defined in `app.css`.
 */
const ALLOW_LIST = new Set<string>([]);

const DEFINITION = /(?:^|[\s;{"'`])(--[a-zA-Z0-9_-]+)\s*:|style:(--[a-zA-Z0-9_-]+)\s*=/g;
const REFERENCE = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

function names(source: string, pattern: RegExp): Set<string> {
	const out = new Set<string>();
	for (const m of source.matchAll(pattern)) out.add(m[1] ?? m[2]);
	return out;
}

/** Variables referenced by `component` that neither `appCss` nor the component itself defines. */
export function findUndefinedVariables(component: string, appCss: string): string[] {
	const defined = new Set([...names(appCss, DEFINITION), ...names(component, DEFINITION)]);
	return [...names(component, REFERENCE)].filter((v) => !defined.has(v) && !ALLOW_LIST.has(v)).sort();
}

function* svelteFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* svelteFiles(path);
		else if (entry.endsWith('.svelte')) yield path;
	}
}

describe('findUndefinedVariables', () => {
	const appCss = ':root { --color-text: #000; }';

	it('flags a variable defined nowhere, even when it has a fallback', () => {
		const c = '<style>.a { background: var(--color-surface, #fff); color: var(--color-text); }</style>';
		expect(findUndefinedVariables(c, appCss)).toEqual(['--color-surface']);
	});

	it('accepts variables from app.css and from the component itself', () => {
		const c = '<div style="--w: 3px"></div><style>.a { --gap: 1px; margin: var(--gap); width: var(--w); color: var(--color-text); }</style>';
		expect(findUndefinedVariables(c, appCss)).toEqual([]);
	});

	it('accepts a style: directive definition', () => {
		expect(findUndefinedVariables('<div style:--c={x}></div><style>i { color: var(--c); }</style>', appCss)).toEqual([]);
	});
});

describe('every var(--x) in app/src is defined', () => {
	const appCss = readFileSync('src/app.css', 'utf8');
	for (const file of svelteFiles('src')) {
		it(file, () => {
			expect(findUndefinedVariables(readFileSync(file, 'utf8'), appCss)).toEqual([]);
		});
	}
});
