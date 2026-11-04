import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec/reduce-requests STORY-303: `fetchFullSchemaForAllNamespaces()` costs 8-13 requests per
 * namespace, so screens must take the schema from `schemaStore` (lib/stores/schema-store.ts), which loads it
 * once and shares it. A direct call silently brings the request storm back (168 requests to open the
 * identity browser on a 12-namespace repository).
 */
const CALL = /\bfetchFullSchemaForAllNamespaces\s*\(/;

/** Files allowed to call it directly, each with the reason. Keep this list short. */
const ALLOWED: Record<string, string> = {
	'lib/services/sparql-connector.ts': 'the connector composes its own methods from it'
};

/** Code lines only: whole-line comments (`//`, `*`, `/*`, `<!--`) are documentation. */
export function findDirectFullLoads(source: string): string[] {
	const found: string[] = [];
	source.split('\n').forEach((line, i) => {
		const t = line.trim();
		if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
		if (CALL.test(line)) found.push(`line ${i + 1}: ${t}`);
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

describe('findDirectFullLoads', () => {
	it('flags direct calls', () => {
		expect(findDirectFullLoads('const s = await sparqlConnector.fetchFullSchemaForAllNamespaces();')).toHaveLength(1);
		expect(findDirectFullLoads('x = await connector.fetchFullSchemaForAllNamespaces(namespaces, {})')).toHaveLength(1);
	});

	it('accepts the store and comments', () => {
		expect(findDirectFullLoads("const s = await schemaStore.ensureLoaded('schema');")).toEqual([]);
		expect(findDirectFullLoads('// uses fetchFullSchemaForAllNamespaces() today')).toEqual([]);
		expect(findDirectFullLoads(' * callers pass `fetchFullSchemaForAllNamespaces()` directly')).toEqual([]);
	});
});

describe('app/src', () => {
	it('takes the schema from schemaStore, never from a direct full load', () => {
		const root = join(process.cwd(), 'src');
		const violations: string[] = [];
		for (const file of sourceFiles(root)) {
			const rel = relative(root, file).split(sep).join('/');
			if (rel in ALLOWED) continue;
			for (const v of findDirectFullLoads(readFileSync(file, 'utf8'))) violations.push(`${rel} ${v}`);
		}
		expect(violations).toEqual([]);
	});

	it('keeps the allow-list honest: every entry still exists and still makes the call', () => {
		const root = join(process.cwd(), 'src');
		for (const rel of Object.keys(ALLOWED)) {
			const source = readFileSync(join(root, rel), 'utf8');
			expect(findDirectFullLoads(source).length, `${rel} no longer needs its allow-list entry`).toBeGreaterThan(0);
		}
	});
});
