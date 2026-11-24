import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRouteView } from './route-views';

/**
 * The review pages are for reading (ontology-pipeline STORY-335): they must not write. Statically, nothing
 * under `routes/review` or the review-only components may name a connector write, an update endpoint or a
 * change log write. (The shared read-only components are covered by their own specs.)
 */
const SRC = join(__dirname, '..', '..');
const roots = [
	join(SRC, 'routes', 'review'),
	join(SRC, 'lib', 'components', 'ConceptReview.svelte'),
	join(SRC, 'lib', 'components', 'GlossaryBrowser.svelte'),
	join(SRC, 'lib', 'components', 'SchemePrintView.svelte'),
	join(SRC, 'lib', 'components', 'TaxonomyGraph.svelte'),
	// The dashboard the review page shares with the editor: never a write itself. (DashboardGrid is left out: its drag
	// handler calls `dataTransfer.setData`, which the pattern would take for a connector write; its own spec covers `readonly`.)
	join(SRC, 'lib', 'components', 'OntologyDashboard.svelte'),
	join(SRC, 'lib', 'components', 'GovernanceTile.svelte'),
	join(SRC, 'lib', 'components', 'RecentChangesTile.svelte'),
	join(SRC, 'lib', 'stores', 'ontology-dashboard-state.svelte.ts'),
	join(SRC, 'lib', 'stores', 'ontology-dashboard-deps.ts')
];

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

describe('review pages cannot open the Triples panel (triples-tabs STORY-605)', () => {
	it('the route table hides View Triples on /review/*', () => {
		for (const p of ['/review/glossary', '/review/scheme', '/review/pipeline']) {
			expect(resolveRouteView(p).canViewTriples).toBe(false);
		}
	});

	it('the layout gates both the menu entry and the panel host on it', () => {
		const layout = readFileSync(join(SRC, 'routes', '+layout.svelte'), 'utf8');
		expect(layout).toMatch(/\{#if routeView\.canViewTriples\}\s*<button[\s\S]{0,120}?triplesPanel\.toggle/);
		expect(layout).toMatch(/\{#if triplesPanel\.open && [^}]*routeView\.canViewTriples\}/);
	});

	it('review sources never reference the panel', () => {
		for (const file of roots.flatMap(files).filter((f) => /\.(svelte|ts)$/.test(f) && !f.endsWith('.spec.ts'))) {
			expect(readFileSync(file, 'utf8')).not.toMatch(/TriplesPanel|triplesPanel|triples-panel-store/);
		}
	});
});
