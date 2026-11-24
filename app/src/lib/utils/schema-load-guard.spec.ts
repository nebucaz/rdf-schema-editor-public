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

/**
 * spec/instance-mgmt-issue STORY-613: these loaders fall back to the same unbatched full load when called
 * without a schema, which is how STORY-612's ~170 requests slipped past the guard above.
 */
const NO_ARG_CALL = /\b(fetchNameableEntities|fetchRelationPredicateOptions|fetchAddableWorkspaceElements)\s*\(\s*\)/;

/** Files allowed to make a no-argument call, each with the reason. */
const NO_ARG_ALLOWED: Record<string, { reason: string; max: number }> = {
	'lib/services/sparql-connector.ts': {
		reason: 'the connector composes its own methods (fetchAddableWorkspaceElements)',
		max: Infinity
	},
	// `max` pins the count, so a second no-argument call in the same file still fails.
	'routes/+page.svelte': {
		reason:
			'openAddEntityDialog falls back to fetchAddableWorkspaceElements() only while lastFetchedSchema is still null (before the first canvas load)',
		max: 1
	}
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

/** Same rules as `findDirectFullLoads`, for calls of the schema-taking loaders without an argument. */
export function findNoArgSchemaLoads(source: string): string[] {
	const found: string[] = [];
	source.split('\n').forEach((line, i) => {
		const t = line.trim();
		if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
		if (NO_ARG_CALL.test(line)) found.push(`line ${i + 1}: ${t}`);
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

describe('findNoArgSchemaLoads', () => {
	it('flags calls without a schema', () => {
		expect(findNoArgSchemaLoads('await c.fetchNameableEntities()')).toHaveLength(1);
		expect(findNoArgSchemaLoads('await c.fetchRelationPredicateOptions( )')).toHaveLength(1);
		expect(findNoArgSchemaLoads('await c.fetchAddableWorkspaceElements();')).toHaveLength(1);
	});

	it('accepts calls with a schema and comments', () => {
		expect(findNoArgSchemaLoads('await c.fetchNameableEntities(schema)')).toEqual([]);
		expect(findNoArgSchemaLoads('// fetchNameableEntities() without a schema')).toEqual([]);
	});
});

describe('app/src', () => {
	it('passes a loaded schema to the option loaders', () => {
		const root = join(process.cwd(), 'src');
		const violations: string[] = [];
		for (const file of sourceFiles(root)) {
			const rel = relative(root, file).split(sep).join('/');
			const found = findNoArgSchemaLoads(readFileSync(file, 'utf8'));
			if (found.length <= (NO_ARG_ALLOWED[rel]?.max ?? 0)) continue;
			for (const v of found) violations.push(`${rel} ${v}`);
		}
		expect(violations).toEqual([]);
	});

	it('keeps the no-argument allow-list honest', () => {
		const root = join(process.cwd(), 'src');
		for (const [rel, { reason }] of Object.entries(NO_ARG_ALLOWED)) {
			expect(reason.length).toBeGreaterThan(0);
			const source = readFileSync(join(root, rel), 'utf8');
			expect(findNoArgSchemaLoads(source).length, `${rel} no longer needs its allow-list entry`).toBeGreaterThan(0);
		}
	});

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
