import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The review pages are for reading (ontology-pipeline STORY-335): they must not write. Statically, nothing
 * under `routes/review` or the review-only components may name a connector write, an update endpoint or a
 * change log write. (The shared read-only components are covered by their own specs.)
 */
const SRC = join(__dirname, '..', '..');
const roots = [join(SRC, 'routes', 'review'), join(SRC, 'lib', 'components', 'ConceptReview.svelte')];

function files(path: string): string[] {
	if (statSync(path).isFile()) return [path];
	return readdirSync(path).flatMap((name) => files(join(path, name)));
}

const WRITES = [
	/executeUpdate/,
	/sparql\/update/,
	/\.(insert|update|delete|set|add|remove|promote|decide|start|save|rename|link|create|mark)[A-Z]\w*\(/,
	/postChangeLogEntry|recordChange|logChange/,
	/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/
];

describe('review pages are read-only (STORY-335)', () => {
	const sources = roots.flatMap(files).filter((f) => /\.(svelte|ts)$/.test(f) && !f.endsWith('.spec.ts'));

	it('finds the review sources', () => {
		expect(sources.length).toBeGreaterThanOrEqual(4);
	});

	for (const file of sources) {
		it(`${file.slice(SRC.length + 1)} makes no write call`, () => {
			const text = readFileSync(file, 'utf8');
			for (const pattern of WRITES) expect(text, String(pattern)).not.toMatch(pattern);
		});
	}
});
