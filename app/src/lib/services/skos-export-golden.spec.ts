import { readFileSync } from 'node:fs';
import { Parser, type Quad, type Term } from 'n3';
import { describe, expect, it } from 'vitest';
import { skosExportQuads, type SkosVocabulary } from './skos-export';

// Shared with the Go backend (backend/internal/glossary): `glossary.json` holds the vocabulary in the app's own model,
// `glossary.ttl` is what the Go API writes for it. The two serializers must state the same triples; the only
// difference is that the API never serves hidden labels.
const dir = new URL('../../../../backend/testdata/golden/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('glossary.json', dir), 'utf8')) as SkosVocabulary & { note: string };
const goTurtle = readFileSync(new URL('glossary.ttl', dir), 'utf8');

const termKey = (t: Term) => `${t.termType}|${t.value}|${'language' in t ? t.language : ''}|${'datatype' in t ? (t.datatype as Term).value : ''}`;
const keys = (quads: Quad[]) => new Set(quads.map((q) => [q.subject, q.predicate, q.object].map(termKey).join(' ')));

describe('Turtle golden vectors shared with the Go backend (STORY-428)', () => {
	const vocab: SkosVocabulary = { schemes: fixture.schemes, concepts: fixture.concepts, collections: [] };
	const fromTs = skosExportQuads(vocab).filter((q) => !q.predicate.value.endsWith('core#hiddenLabel'));
	const fromGo = new Parser().parse(goTurtle);

	it('the TS export of the fixture states the same triples as the Go API', () => {
		const ts = keys(fromTs);
		const go = keys(fromGo);
		expect([...ts].filter((k) => !go.has(k))).toEqual([]);
		expect([...go].filter((k) => !ts.has(k))).toEqual([]);
	});

	it('the Go output has no hidden labels, editorial notes or rse: fields', () => {
		expect(goTurtle).not.toMatch(/hiddenLabel|editorialNote|Headcount|Sister|ask HR|internal remark/);
		expect(fromGo.some((q) => q.predicate.value.includes('/schema#'))).toBe(false);
	});
});
