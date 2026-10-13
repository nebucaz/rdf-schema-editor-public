import { describe, it, expect, vi } from 'vitest';
import {
	toFactKey,
	collectFactKeys,
	loadPageAnnotations,
	annotationsForFact,
	badgeSummary,
	authorDisplay,
	describeAnnotation,
	formatAnnotatedAt
} from './annotation-badges';
import { factKeyString, type FetchedAnnotation } from './sparql-connector';
import type { CellFact, ResultCell, ResultRows } from './query-results';

const NS = 'http://example.org/ns';
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const fact = (subject: string, value: string, extra: Partial<CellFact['object']> = {}): CellFact => ({
	subjectIri: `${NS}#${subject}`,
	predicateIri: `${NS}#hostname`,
	object: { value, isIri: false, ...extra }
});
const cell = (columnId: string, f?: CellFact): ResultCell => ({
	columnId, header: columnId, text: f?.object.value ?? '', rawValue: f?.object.value ?? '', isMeasure: false, fact: f
});
const table = (...rows: ResultCell[][]): ResultRows => ({ headers: [], rows });

describe('toFactKey', () => {
	it('converts a literal cell fact, keeping datatype and language', () => {
		expect(toFactKey(fact('a', '42', { datatype: `${XSD}integer` }))).toEqual({
			subjectIri: `${NS}#a`,
			predicateIri: `${NS}#hostname`,
			object: { kind: 'literal', value: '42', datatype: `${XSD}integer` }
		});
		expect(toFactKey(fact('a', 'hallo', { lang: 'de' })).object).toEqual({ kind: 'literal', value: 'hallo', lang: 'de' });
	});
	it('converts an IRI cell fact', () => {
		expect(toFactKey(fact('a', `${NS}#b`, { isIri: true })).object).toEqual({ kind: 'iri', iri: `${NS}#b` });
	});
});

describe('collectFactKeys', () => {
	it('collects each distinct fact once and ignores cells without a fact', () => {
		const t = table(
			[cell('c1', fact('a', 'x')), cell('c2')],
			[cell('c1', fact('a', 'x')), cell('c2')],
			[cell('c1', fact('b', 'y')), cell('c2', fact('b', 'z'))]
		);
		const keys = collectFactKeys(t);
		expect(keys).toHaveLength(3);
		expect(new Set(keys.map(factKeyString)).size).toBe(3);
	});
	it('is empty for a table with no fact-bearing cells (e.g. aggregates)', () => {
		expect(collectFactKeys(table([cell('c1')]))).toEqual([]);
		expect(collectFactKeys(table())).toEqual([]);
	});
});

const ann = (over: Partial<FetchedAnnotation> = {}): FetchedAnnotation => ({
	iri: `${NS}#ann1`, type: 'text', text: 'check this', annotatedBy: 'u-1', annotatedAt: '2026-03-01T10:15:30Z', ...over
});

describe('loadPageAnnotations', () => {
	const t = table([cell('c1', fact('a', 'x')), cell('c2', fact('a', 'y'))], [cell('c1', fact('b', 'x'))]);

	it('makes exactly one batch request for every fact-bearing cell', async () => {
		const fetchAnnotationsForFacts = vi.fn(async () => new Map<string, FetchedAnnotation[]>());
		await loadPageAnnotations({ fetchAnnotationsForFacts }, t);
		expect(fetchAnnotationsForFacts).toHaveBeenCalledTimes(1);
		const [facts] = fetchAnnotationsForFacts.mock.calls[0] as unknown as [unknown[]];
		expect(facts).toHaveLength(3);
	});

	it('makes no request when the page has no facts', async () => {
		const fetchAnnotationsForFacts = vi.fn(async () => new Map<string, FetchedAnnotation[]>());
		const result = await loadPageAnnotations({ fetchAnnotationsForFacts }, table([cell('c1')]));
		expect(fetchAnnotationsForFacts).not.toHaveBeenCalled();
		expect(result.size).toBe(0);
	});

	it('degrades to no badges (with a warning) when the request fails', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const result = await loadPageAnnotations(
			{ fetchAnnotationsForFacts: async () => { throw new Error('boom'); } },
			t
		);
		expect(result.size).toBe(0);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});

describe('annotationsForFact', () => {
	it('looks a cell fact up by its canonical key', () => {
		const f = fact('a', 'x');
		const map = new Map([[factKeyString(toFactKey(f)), [ann()]]]);
		expect(annotationsForFact(map, f)).toHaveLength(1);
		expect(annotationsForFact(map, fact('a', 'other'))).toEqual([]);
		expect(annotationsForFact(map, undefined)).toEqual([]);
	});
});

describe('badgeSummary', () => {
	it('is null when there is nothing to show', () => {
		expect(badgeSummary([])).toBeNull();
	});
	it('shows the count for text annotations or several annotations', () => {
		expect(badgeSummary([ann()])).toEqual({ text: '1', count: 1 });
		expect(badgeSummary([ann(), ann({ iri: `${NS}#ann2` })])).toEqual({ text: '2', count: 2 });
	});
	it('shows the label text for a single enumerated-label annotation', () => {
		expect(badgeSummary([ann({ type: 'label', text: undefined, labelIri: `${NS}#Verified`, labelText: 'Verified' })]))
			.toEqual({ text: 'Verified', count: 1 });
		expect(badgeSummary([ann({ type: 'label', text: undefined, labelIri: `${NS}#Approved` })]))
			.toEqual({ text: 'Approved', count: 1 });
	});
});

describe('author display', () => {
	const me = { sub: 'u-1', displayName: 'Alice Example' };
	it('shows the display name for the current user and the stored sub otherwise', () => {
		expect(authorDisplay('u-1', me)).toBe('Alice Example');
		expect(authorDisplay('u-2', me)).toBe('u-2');
		expect(authorDisplay('u-1', null)).toBe('u-1');
	});
	it('describes text and label annotations with author and date', () => {
		expect(describeAnnotation(ann(), me)).toEqual({
			iri: `${NS}#ann1`, kind: 'text', content: 'check this', author: 'Alice Example', date: '2026-03-01 10:15 UTC'
		});
		expect(describeAnnotation(ann({ type: 'label', text: undefined, labelIri: `${NS}#Investigate`, labelText: 'Investigate', annotatedBy: 'u-9' }), me))
			.toMatchObject({ kind: 'label', content: 'Investigate', author: 'u-9' });
	});
	it('formats timestamps deterministically and passes unparseable ones through', () => {
		expect(formatAnnotatedAt('2026-03-01T10:15:30.123Z')).toBe('2026-03-01 10:15 UTC');
		expect(formatAnnotatedAt('not a date')).toBe('not a date');
	});
});
