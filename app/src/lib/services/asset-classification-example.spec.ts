import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSkosTurtle } from './skos-import';

const file = readFileSync(new URL('../../../../examples/asset-classification/asset-classification.ttl', import.meta.url), 'utf8');

describe('examples/asset-classification', () => {
	const parsed = parseSkosTurtle(file);

	it('imports without issues or skipped constructs', () => {
		expect(parsed.concepts).toHaveLength(28);
		expect(parsed.skipped).toEqual([]);
	});

	it('has the links the Taxonomy graph can draw', () => {
		const kinds = new Set(parsed.concepts.flatMap((c) => (c.mappings ?? []).map((m) => m.kind)));
		expect([...kinds].sort()).toEqual(['closeMatch', 'exactMatch', 'relatedMatch']);
		expect(parsed.concepts.some((c) => (c.related ?? []).length > 0)).toBe(true);
		expect(parsed.concepts.some((c) => (c.broader ?? []).length > 1)).toBe(true);
	});
});
