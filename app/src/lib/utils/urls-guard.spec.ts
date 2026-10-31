import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec/deployment-req STORY-010: backend URLs must come from `apiUrl()` and in-app links
 * from `appUrl()`/`absoluteAppUrl()` (lib/utils/urls.ts). A bare `/api/...` literal or an absolute
 * `href="/..."` / `goto('/...')` would silently break under APP_BASE_PATH / API_PREFIX.
 */
const RULES: { name: string; pattern: RegExp }[] = [
	{ name: 'bare /api literal (use apiUrl())', pattern: /(['"`])\/api(\/|\1)/ },
	{ name: 'absolute href="/…" (use appUrl())', pattern: /\bhref=["']\/[^"']*["']/ },
	{ name: "absolute goto('/…') (use appUrl())", pattern: /\bgoto\(\s*['"`]\// }
];

/** Code lines only: whole-line comments (`//`, `*`, `/**`, `<!--`) are documentation. */
export function findUrlViolations(source: string): string[] {
	const found: string[] = [];
	source.split('\n').forEach((line, i) => {
		const t = line.trim();
		if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
		for (const rule of RULES) if (rule.pattern.test(line)) found.push(`line ${i + 1}: ${rule.name}: ${t}`);
	});
	return found;
}

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* sourceFiles(path);
		else if (/\.(ts|svelte)$/.test(entry) && !/\.spec\.ts$/.test(entry)) yield path;
	}
}

describe('findUrlViolations', () => {
	it('flags seeded violations', () => {
		expect(findUrlViolations("fetch('/api/me')")).toHaveLength(1);
		expect(findUrlViolations('fetch(`/api/shared-queries/${id}`)')).toHaveLength(1);
		expect(findUrlViolations('<a href="/workbench">x</a>')).toHaveLength(1);
		expect(findUrlViolations("void goto('/identities')")).toHaveLength(1);
	});

	it('accepts helper use and comments', () => {
		expect(findUrlViolations("fetch(apiUrl('/me'))")).toEqual([]);
		expect(findUrlViolations('<a href={appUrl(\'/\')}>x</a>')).toEqual([]);
		expect(findUrlViolations('goto(appUrl(\'/identities\'))')).toEqual([]);
		expect(findUrlViolations(' * `GET /api/config` is loaded once')).toEqual([]);
		expect(findUrlViolations('// fetch("/api/me")')).toEqual([]);
	});
});

describe('app/src', () => {
	it('builds every backend and in-app URL through lib/utils/urls.ts', () => {
		const root = join(process.cwd(), 'src');
		const violations: string[] = [];
		for (const file of sourceFiles(root)) {
			const rel = relative(root, file).split(sep).join('/');
			if (rel === 'lib/utils/urls.ts') continue;
			for (const v of findUrlViolations(readFileSync(file, 'utf8'))) violations.push(`${rel} ${v}`);
		}
		expect(violations).toEqual([]);
	});
});
