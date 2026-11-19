import { afterEach, describe, expect, it, vi } from 'vitest';
import { SparqlConnector } from './sparql-connector';
import type { ConceptDraft } from './skos-concept';
import { namespaceGraphs } from '#lib/config.js';
import {
	CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI,
	CONCEPT_STATUS_PREDICATE_IRI,
	NAMESPACE_VOCABULARY_PREDICATE_IRI,
	SKOS,
	conceptIri,
	conceptSchemeIri
} from '#lib/utils/iri.js';

const CORE = 'http://example.org/core';
const VOCAB = namespaceGraphs(CORE, { vocab: true }).vocab!;

const draft: ConceptDraft = {
	prefLabels: [{ text: 'Bank', lang: 'en' }],
	altLabels: [{ text: 'Credit "institution"', lang: 'en' }],
	hiddenLabels: [],
	definition: 'A financial institution.',
	scopeNote: '',
	disambiguation: 'finance',
	schemeIri: `${VOCAB}#GlossaryScheme`,
	topConcept: true,
	status: 'proposed',
	source: 'ISO 704',
	authority: 'Data Office',
	replacedBy: '',
	deprecationReason: ''
};

type Row = Record<string, { type?: string; value: string } | undefined>;

function mockFetch(
	fixture: {
		exists?: boolean;
		select?: (q: string) => Row[] | undefined;
	} = {}
) {
	const updates: string[] = [];
	const queries: string[] = [];
	const fn = vi.fn(async (_url: string, opts: { body: string }) => {
		const body = JSON.parse(opts.body);
		if (body.update !== undefined) {
			updates.push(body.update);
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}
		const q: string = body.query;
		queries.push(q);
		if (q.includes('ASK')) return new Response(JSON.stringify({ head: {}, boolean: fixture.exists ?? false }), { status: 200 });
		return new Response(
			JSON.stringify({ head: { vars: [] }, results: { bindings: fixture.select?.(q) ?? [] } }),
			{ status: 200 }
		);
	});
	return { fn, updates, queries };
}

const connector = () => new SparqlConnector('/api/sparql');

describe('concept IRIs (STORY-322)', () => {
	it('mints from the preferred label plus the qualifier, in the vocab graph', () => {
		expect(conceptIri('Bank', 'finance', CORE)).toBe(`${VOCAB}#BankFinance`);
		expect(conceptIri('Customer', '', CORE)).toBe(`${VOCAB}#Customer`);
		expect(conceptSchemeIri('Business glossary', CORE)).toBe(`${VOCAB}#BusinessGlossaryScheme`);
	});
});

describe('SparqlConnector — vocabulary namespace lookup (STORY-322)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('returns the marked namespace, or null when none is marked', async () => {
		const { fn, queries } = mockFetch({ select: () => [{ ns: { value: CORE } }] });
		vi.stubGlobal('fetch', fn);
		expect(await connector().fetchVocabularyNamespace()).toBe(CORE);
		expect(queries[0]).toContain(NAMESPACE_VOCABULARY_PREDICATE_IRI);

		vi.stubGlobal('fetch', mockFetch().fn);
		expect(await connector().fetchVocabularyNamespace()).toBeNull();
	});
});

describe('SparqlConnector — concept schemes (STORY-322)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertConceptScheme writes a skos:ConceptScheme with escaped label to the vocab graph', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await connector().insertConceptScheme(CORE, { name: 'Business "glossary"', description: 'Terms' });
		expect(iri).toBe(conceptSchemeIri('Business "glossary"', CORE));
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${VOCAB}>`);
		expect(updates[0]).toContain(`<${iri}> a <${SKOS.ConceptScheme}>`);
		expect(updates[0]).toContain('rdfs:label "Business \\"glossary\\""');
	});

	it('insertConceptScheme refuses an existing scheme', async () => {
		vi.stubGlobal('fetch', mockFetch({ exists: true }).fn);
		await expect(connector().insertConceptScheme(CORE, { name: 'Glossary', description: '' })).rejects.toThrow(/already exists/);
	});

	it('fetchConceptSchemes reads iri, label and description in one query', async () => {
		const { fn, queries } = mockFetch({
			select: () => [{ s: { value: `${VOCAB}#GlossaryScheme` }, label: { value: 'Glossary' }, desc: { value: 'Terms' } }]
		});
		vi.stubGlobal('fetch', fn);
		expect(await connector().fetchConceptSchemes(CORE)).toEqual([
			{
				iri: `${VOCAB}#GlossaryScheme`,
				name: 'Glossary',
				description: 'Terms',
				scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' },
				metadata: { title: '', creator: '', publisher: '', rights: '', modified: '' }
			}
		]);
		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain(`FROM <${VOCAB}>`);
	});
});

describe('SparqlConnector — scheme scope record (STORY-323, book p. 22)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const scheme = `${VOCAB}#GlossaryScheme`;

	it('fetchConceptSchemes reads the scope fields', async () => {
		const { fn } = mockFetch({
			select: () => [
				{
					s: { value: scheme },
					label: { value: 'Glossary' },
					purpose: { value: 'Shared business terms' },
					decisions: { value: 'Which systems hold PII' },
					outOfScope: { value: 'Product codes' },
					stakeholders: { value: 'Data Office' }
				}
			]
		});
		vi.stubGlobal('fetch', fn);
		const [s] = await connector().fetchConceptSchemes(CORE);
		expect(s.scope).toEqual({
			purpose: 'Shared business terms',
			decisionsSupported: 'Which systems hold PII',
			outOfScope: 'Product codes',
			stakeholders: 'Data Office'
		});
	});

	it('updateConceptSchemeScope replaces the four fields in one request with escaped literals', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		await connector().updateConceptSchemeScope(CORE, scheme, {
			purpose: 'Terms for "PII" work',
			decisionsSupported: '',
			outOfScope: 'Codes',
			stakeholders: 'Data Office'
		});
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain('"Terms for \\"PII\\" work"');
		expect(u).toContain('Data Office');
		expect(u).not.toContain('decisionsSupported> "');
		expect((u.match(/DELETE WHERE/g) ?? []).length).toBe(4);
	});

	it('updateConceptSchemeScope refuses an unknown scheme', async () => {
		vi.stubGlobal('fetch', mockFetch({ exists: false }).fn);
		await expect(
			connector().updateConceptSchemeScope(CORE, scheme, { purpose: 'x', decisionsSupported: '', outOfScope: '', stakeholders: '' })
		).rejects.toThrow(/not found/i);
	});
});

describe('SparqlConnector — scheme metadata (STORY-408)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const scheme = `${VOCAB}#GlossaryScheme`;
	const DC = 'http://purl.org/dc/terms/';

	it('fetchConceptSchemes reads the dct: properties, and none means empty strings', async () => {
		vi.stubGlobal('fetch', mockFetch({
			select: () => [
				{ s: { value: scheme }, label: { value: 'Glossary' }, dctTitle: { value: 'Business glossary' }, creator: { value: 'Ann' },
				  publisher: { value: 'https://ex.org/o', type: 'uri' }, rights: { value: 'CC-BY' }, modified: { value: '2026-11-17T06:30:15Z' } },
				{ s: { value: `${VOCAB}#Other` }, label: { value: 'Other' } }
			]
		}).fn);
		const [a, b] = await connector().fetchConceptSchemes(CORE);
		expect(a.metadata).toEqual({ title: 'Business glossary', creator: 'Ann', publisher: 'https://ex.org/o', rights: 'CC-BY', modified: '2026-11-17T06:30:15Z' });
		expect(b.metadata).toEqual({ title: '', creator: '', publisher: '', rights: '', modified: '' });
	});

	it('updateConceptSchemeMetadata writes IRIs as IRIs, literals escaped, and stamps modified itself', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		await connector().updateConceptSchemeMetadata(CORE, scheme, {
			title: 'The "glossary"', creator: 'https://ex.org/o/ann', publisher: 'Data Office', rights: '', modified: '1999-01-01T00:00:00Z'
		});
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain(`<${DC}title> "The \\"glossary\\""`);
		expect(u).toContain(`<${DC}creator> <https://ex.org/o/ann>`);
		expect(u).toContain(`<${DC}publisher> "Data Office"`);
		expect(u).not.toContain(`<${DC}rights> "`);
		expect(u).not.toContain('1999-01-01');
		expect(u).toMatch(/modified> "\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"\^\^xsd:dateTime/);
	});

	it('updateConceptSchemeMetadata refuses an unsafe agent IRI and an unknown scheme, writing nothing', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		const meta = { title: '', creator: 'http://x/> } DROP', publisher: '', rights: '', modified: '' };
		await expect(connector().updateConceptSchemeMetadata(CORE, scheme, meta)).rejects.toThrow();
		expect(updates).toHaveLength(0);
		vi.stubGlobal('fetch', mockFetch({ exists: false }).fn);
		await expect(connector().updateConceptSchemeMetadata(CORE, scheme, { ...meta, creator: '' })).rejects.toThrow(/not found/i);
	});

	it('creating, editing and deleting a concept touch the scheme dct:modified in the same request', async () => {
		for (const run of [
			(c: SparqlConnector) => c.insertConcept(CORE, draft),
			(c: SparqlConnector) => c.updateConcept(CORE, `${VOCAB}#BankFinance`, draft),
			(c: SparqlConnector) => c.deleteConcept(CORE, `${VOCAB}#BankFinance`)
		]) {
			const { fn, updates } = mockFetch({ exists: true });
			vi.stubGlobal('fetch', fn);
			try { await run(connector()); } catch { /* insert refuses an existing IRI below */ }
			if (!updates.length) {
				const fresh = mockFetch({ exists: false });
				vi.stubGlobal('fetch', fresh.fn);
				await run(connector());
				updates.push(...fresh.updates);
			}
			expect(updates).toHaveLength(1);
			expect(updates[0]).toContain(`<${SKOS.inScheme}> ?scheme`);
			expect(updates[0]).toMatch(/\?scheme <http:\/\/purl\.org\/dc\/terms\/modified> "\d{4}-\d\d-\d\dT[\d:]+Z"\^\^xsd:dateTime/);
		}
	});
});

describe('SparqlConnector — concepts (STORY-322)', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('insertConcept mints the IRI, writes every field with guards, and stamps created/modified', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		const iri = await connector().insertConcept(CORE, draft);

		expect(iri).toBe(`${VOCAB}#BankFinance`);
		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain(`GRAPH <${VOCAB}>`);
		expect(u).toContain(`<${iri}> a <${SKOS.Concept}>`);
		expect(u).toContain(`<${SKOS.prefLabel}> "Bank"@en`);
		expect(u).toContain(`<${SKOS.altLabel}> "Credit \\"institution\\""@en`);
		expect(u).toContain(`<${SKOS.definition}> "A financial institution."`);
		expect(u).toContain(`<${SKOS.inScheme}> <${draft.schemeIri}>`);
		expect(u).toContain(`<${SKOS.topConceptOf}> <${draft.schemeIri}>`);
		expect(u).toContain(`<${CONCEPT_STATUS_PREDICATE_IRI}> "proposed"`);
		expect(u).toMatch(/dct:created|purl\.org\/dc\/terms\/created> "\d{4}-\d{2}-\d{2}"\^\^xsd:date/);
		expect(u).toMatch(/modified> "\d{4}-\d{2}-\d{2}"\^\^xsd:date/);
	});

	it('insertConcept writes each notation as an escaped plain literal and skips blanks (STORY-406)', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().insertConcept(CORE, { ...draft, notation: ['WH "01"', '  ', 'B2'] });
		expect(updates[0]).toContain(`<${SKOS.notation}> "WH \\"01\\""`);
		expect(updates[0]).toContain(`<${SKOS.notation}> "B2"`);
		expect(updates[0].match(/skos\/core#notation>/g)).toHaveLength(2);
	});

	it('updateConcept rewrites notation but keeps broader, related and mappings (STORY-406)', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		await connector().updateConcept(CORE, `${VOCAB}#BankFinance`, { ...draft, notation: ['N1'] });
		expect(updates[0]).toContain(`<${SKOS.notation}> "N1"`);
		const keep = updates[0].match(/NOT IN \(([^)]*)\)/)![1];
		expect(keep).not.toContain(SKOS.notation);
		for (const p of [SKOS.related, SKOS.exactMatch]) expect(keep).toContain(p);
	});

	it('insertConcept writes examples and editorial notes escaped, and never a history note (STORY-407)', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().insertConcept(CORE, { ...draft, example: ['A "retail" bank'], editorialNote: ['Ask legal', ' '] });
		expect(updates[0]).toContain(`<${SKOS.example}> "A \\"retail\\" bank"`);
		expect(updates[0]).toContain(`<${SKOS.editorialNote}> "Ask legal"`);
		expect(updates[0].match(/core#editorialNote>/g)).toHaveLength(1);
		expect(updates[0]).not.toContain('historyNote');
		expect(updates[0]).not.toContain('changeNote');
	});

	it('updateConcept does not preserve example or editorial note, so an edit can remove them (STORY-407)', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		await connector().updateConcept(CORE, `${VOCAB}#BankFinance`, { ...draft, example: ['E'] });
		const keep = updates[0].match(/NOT IN \(([^)]*)\)/)![1];
		expect(keep).not.toContain(SKOS.example);
		expect(keep).not.toContain(SKOS.editorialNote);
	});

	it('fetchConcepts reads examples and editorial notes (STORY-407)', async () => {
		const c = `${VOCAB}#X`;
		vi.stubGlobal('fetch', mockFetch({
			select: () => [
				{ c: { value: c }, p: { value: SKOS.prefLabel }, o: { value: 'X' }, lang: { value: 'en' } },
				{ c: { value: c }, p: { value: SKOS.example }, o: { value: 'E1' } },
				{ c: { value: c }, p: { value: SKOS.example }, o: { value: 'E2' } },
				{ c: { value: c }, p: { value: SKOS.editorialNote }, o: { value: 'N1' } }
			]
		}).fn);
		const { concepts } = await connector().fetchConcepts(CORE);
		expect(concepts[0].example).toEqual(['E1', 'E2']);
		expect(concepts[0].editorialNote).toEqual(['N1']);
	});

	it('fetchConcepts reads notation (STORY-406)', async () => {
		const c = `${VOCAB}#X`;
		vi.stubGlobal('fetch', mockFetch({
			select: () => [
				{ c: { value: c }, p: { value: SKOS.prefLabel }, o: { value: 'X' }, lang: { value: 'en' } },
				{ c: { value: c }, p: { value: SKOS.notation }, o: { value: 'A1' } },
				{ c: { value: c }, p: { value: SKOS.notation }, o: { value: 'B2' } }
			]
		}).fn);
		const { concepts } = await connector().fetchConcepts(CORE);
		expect(concepts[0].notation).toEqual(['A1', 'B2']);
	});

	it('insertConcept rejects an invalid draft and an existing IRI before writing', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await expect(connector().insertConcept(CORE, { ...draft, prefLabels: [] })).rejects.toThrow(/preferred label/i);
		expect(updates).toHaveLength(0);

		vi.stubGlobal('fetch', mockFetch({ exists: true }).fn);
		await expect(connector().insertConcept(CORE, draft)).rejects.toThrow(/already exists/);
	});

	it('insertConcept refuses an unsafe scheme IRI', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().insertConcept(CORE, { ...draft, schemeIri: 'http://x/> } DROP' })).rejects.toThrow();
	});

	it('updateConcept keeps the IRI, created date and deprecation date, and bumps modified', async () => {
		const { fn, updates } = mockFetch({ exists: true });
		vi.stubGlobal('fetch', fn);
		const iri = `${VOCAB}#BankFinance`;
		await connector().updateConcept(CORE, iri, { ...draft, prefLabels: [{ text: 'Banking institution', lang: 'en' }] });

		expect(updates).toHaveLength(1);
		const u = updates[0];
		expect(u).toContain('FILTER(?p NOT IN (');
		expect(u).toContain('created');
		expect(u).toContain('deprecatedOn');
		expect(u).toContain(`<${iri}> a <${SKOS.Concept}>`);
		expect(u).toContain('"Banking institution"@en');
		expect(u).not.toContain(`${VOCAB}#BankingInstitution`);
	});

	it('updateConcept refuses a concept that does not exist', async () => {
		vi.stubGlobal('fetch', mockFetch({ exists: false }).fn);
		await expect(connector().updateConcept(CORE, `${VOCAB}#Nope`, draft)).rejects.toThrow(/not found/i);
	});

	it('fetchConcepts is one paged query that reads every triple, not one row per label combination', async () => {
		const c = `${VOCAB}#BankFinance`;
		const { fn, queries } = mockFetch({
			select: () => [
				{ c: { value: c }, p: { value: SKOS.prefLabel }, o: { value: 'Bank' }, lang: { value: 'en' } },
				{ c: { value: c }, p: { value: SKOS.altLabel }, o: { value: 'Credit house' }, lang: { value: 'en' } },
				{ c: { value: c }, p: { value: SKOS.definition }, o: { value: 'A financial institution.' }, lang: { value: '' } },
				{ c: { value: c }, p: { value: SKOS.inScheme }, o: { value: draft.schemeIri } },
				{ c: { value: c }, p: { value: SKOS.topConceptOf }, o: { value: draft.schemeIri } },
				{ c: { value: c }, p: { value: CONCEPT_STATUS_PREDICATE_IRI }, o: { value: 'active' } },
				{ c: { value: c }, p: { value: 'http://purl.org/dc/terms/created' }, o: { value: '2026-11-01' } }
			]
		});
		vi.stubGlobal('fetch', fn);
		const result = await connector().fetchConcepts(CORE, { limit: 50 });

		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain(`FROM <${VOCAB}>`);
		expect(queries[0]).toContain('LIMIT 51');
		expect(queries[0]).toContain('OFFSET 0');
		expect(result.hasMore).toBe(false);
		expect(result.concepts).toHaveLength(1);
		expect(result.concepts[0]).toMatchObject({
			iri: c,
			prefLabels: [{ text: 'Bank', lang: 'en' }],
			altLabels: [{ text: 'Credit house', lang: 'en' }],
			definition: 'A financial institution.',
			schemeIri: draft.schemeIri,
			topConcept: true,
			status: 'active',
			created: '2026-11-01'
		});
	});

	it('fetchConcepts reports more when the page overflows by one concept and can filter by scheme', async () => {
		const mk = (n: number): Row[] => [
			{ c: { value: `${VOCAB}#C${n}` }, p: { value: SKOS.prefLabel }, o: { value: `C${n}` }, lang: { value: 'en' } }
		];
		const { fn, queries } = mockFetch({ select: () => [...mk(1), ...mk(2), ...mk(3)] });
		vi.stubGlobal('fetch', fn);
		const result = await connector().fetchConcepts(CORE, { limit: 2, offset: 4, schemeIri: draft.schemeIri });
		expect(result.concepts.map((c) => c.iri)).toEqual([`${VOCAB}#C1`, `${VOCAB}#C2`]);
		expect(result.hasMore).toBe(true);
		expect(queries[0]).toContain('OFFSET 4');
		expect(queries[0]).toContain(`<${SKOS.inScheme}> <${draft.schemeIri}>`);
	});

	it('fetchConcepts orders the page by preferred label, then IRI, in the query and in the result (STORY-443)', async () => {
		const row = (n: string, label: string): Row => ({
			c: { value: `${VOCAB}#${n}` }, p: { value: SKOS.prefLabel }, o: { value: label }, lang: { value: 'en' }
		});
		const { fn, queries } = mockFetch({ select: () => [row('A', 'zebra'), row('B', 'Apple'), row('C', 'apple')] });
		vi.stubGlobal('fetch', fn);
		const result = await connector().fetchConcepts(CORE);
		expect(queries[0]).toMatch(/ORDER BY\s+\?sortKey\s+\?c/);
		expect(result.concepts.map((c) => c.iri)).toEqual([`${VOCAB}#B`, `${VOCAB}#C`, `${VOCAB}#A`]);
	});

	it('fetchConcepts filters by search text and status on the server (STORY-443)', async () => {
		const { fn, queries } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().fetchConcepts(CORE, { search: '  Bank ', status: 'active' });
		expect(queries[0]).toContain('CONTAINS(LCASE(STR(?sv)), "bank")');
		expect(queries[0]).toContain(`<${SKOS.prefLabel}>`);
		expect(queries[0]).toContain(`<${SKOS.definition}>`);
		expect(queries[0]).toContain(`<${CONCEPT_STATUS_PREDICATE_IRI}> "active"`);
	});

	it('a search with quotes, backslashes or braces cannot change the query (STORY-443)', async () => {
		const { fn, queries } = mockFetch();
		vi.stubGlobal('fetch', fn);
		await connector().fetchConcepts(CORE, { search: 'a" } . ?x ?y ?z # \\' });
		expect(queries[0]).toContain('"a\\" } . ?x ?y ?z # \\\\"');
		expect(queries[0].match(/"a\\" \} \. \?x/g)).toHaveLength(1);
	});

	it('refuses a scheme IRI that could break out of the query (STORY-443)', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().fetchConcepts(CORE, { schemeIri: 'http://x/a> } DELETE' })).rejects.toThrow();
		await expect(connector().countConcepts(CORE, { schemeIri: 'http://x/a> } DELETE' })).rejects.toThrow();
	});

	it('refuses an unknown status filter (STORY-443)', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().fetchConcepts(CORE, { status: 'x" } #' as never })).rejects.toThrow(/status/i);
	});

	it('countConcepts counts the concepts matching scheme, search and status in one query (STORY-443)', async () => {
		const { fn, queries } = mockFetch({ select: () => [{ n: { value: '137' } }] });
		vi.stubGlobal('fetch', fn);
		const total = await connector().countConcepts(CORE, { schemeIri: draft.schemeIri, search: 'bank', status: 'approved' });
		expect(total).toBe(137);
		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain('COUNT(DISTINCT ?c)');
		expect(queries[0]).toContain(`FROM <${VOCAB}>`);
		expect(queries[0]).toContain(`<${SKOS.inScheme}> <${draft.schemeIri}>`);
		expect(queries[0]).toContain('"bank"');
		expect(queries[0]).toContain('"approved"');
	});

	it('countConcepts is 0 when GraphDB returns no row (STORY-443)', async () => {
		vi.stubGlobal('fetch', mockFetch({ select: () => [] }).fn);
		expect(await connector().countConcepts(CORE)).toBe(0);
	});
});

describe('SparqlConnector — concept status (STORY-322)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const iri = `${VOCAB}#BankFinance`;
	const withStatus = (status: string) => () => [{ status: { value: status } }];

	it('moves one step and stamps modified', async () => {
		const { fn, updates } = mockFetch({ select: withStatus('proposed') });
		vi.stubGlobal('fetch', fn);
		await connector().setConceptStatus(CORE, iri, 'approved');
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`<${CONCEPT_STATUS_PREDICATE_IRI}> "approved"`);
		expect(updates[0]).toContain('modified');
	});

	it('refuses a skipped step and writes nothing', async () => {
		const { fn, updates } = mockFetch({ select: withStatus('proposed') });
		vi.stubGlobal('fetch', fn);
		await expect(connector().setConceptStatus(CORE, iri, 'active')).rejects.toThrow(/proposed to active/);
		expect(updates).toHaveLength(0);
	});

	it('deprecation needs a reason and records reason, replacement and date, and deletes nothing', async () => {
		const { fn, updates } = mockFetch({ select: withStatus('active') });
		vi.stubGlobal('fetch', fn);
		await expect(connector().setConceptStatus(CORE, iri, 'deprecated', {})).rejects.toThrow(/reason/);
		expect(updates).toHaveLength(0);

		await connector().setConceptStatus(CORE, iri, 'deprecated', { reason: 'Merged "into" Client', replacedBy: `${VOCAB}#Client` });
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain('"Merged \\"into\\" Client"');
		expect(updates[0]).toContain(`<${VOCAB}#Client>`);
		expect(updates[0]).toMatch(/deprecatedOn> "\d{4}-\d{2}-\d{2}"\^\^xsd:date/);
		expect(updates[0]).not.toMatch(/DELETE WHERE \{[^}]*<[^>]+> \?p \?o/);
	});

	it('fails when the concept is not found', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().setConceptStatus(CORE, iri, 'approved')).rejects.toThrow(/not found/i);
	});
});

describe('SparqlConnector — deleting a concept (STORY-322)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const iri = `${VOCAB}#BankFinance`;

	it('refuses and reports linked classes and narrower concepts', async () => {
		const { fn, updates, queries } = mockFetch({
			select: (q) => {
				if (q.includes(CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI)) return [{ cls: { value: 'http://example.org/a#Bank' } }];
				if (q.includes(SKOS.broader)) return [{ n: { value: `${VOCAB}#Savings` } }];
				return [];
			}
		});
		vi.stubGlobal('fetch', fn);
		const result = await connector().deleteConcept(CORE, iri);

		expect(result).toEqual({ deleted: false, linkedClasses: ['http://example.org/a#Bank'], narrower: [`${VOCAB}#Savings`], collections: [] });
		expect(updates).toHaveLength(0);
		const classQuery = queries.find((q) => q.includes(CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI))!;
		expect(classQuery).toMatch(/SELECT DISTINCT/);
	});

	it('deletes directly when nothing references the concept', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		expect(await connector().deleteConcept(CORE, iri)).toEqual({ deleted: true, linkedClasses: [], narrower: [], collections: [] });
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`GRAPH <${VOCAB}>`);
		expect(updates[0]).toContain(`<${iri}> ?p ?o`);
	});

	it('force removes the class links, the broader links and the concept itself', async () => {
		const { fn, updates } = mockFetch({
			select: (q) => (q.includes(CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI) ? [{ cls: { value: 'http://example.org/a#Bank' } }] : [])
		});
		vi.stubGlobal('fetch', fn);
		const result = await connector().deleteConcept(CORE, iri, { force: true });
		expect(result.deleted).toBe(true);
		expect(updates).toHaveLength(1);
		expect(updates[0]).toContain(`?cls <${CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI}> <${iri}>`);
		expect(updates[0]).toContain(`<${SKOS.broader}> <${iri}>`);
		expect(updates[0]).toContain(`<${iri}> ?p ?o`);
	});

	it('refuses an unsafe IRI', async () => {
		vi.stubGlobal('fetch', mockFetch().fn);
		await expect(connector().deleteConcept(CORE, 'http://x/> } DROP')).rejects.toThrow();
	});
});

describe('SparqlConnector — skos:hasTopConcept kept beside skos:topConceptOf (STORY-445)', () => {
	afterEach(() => vi.unstubAllGlobals());
	const concept = `${VOCAB}#BankFinance`;
	const inverse = `<${draft.schemeIri}> <${SKOS.hasTopConcept}> <${concept}>`;
	const dropInverse = `DELETE WHERE { GRAPH <${VOCAB}> { ?s <${SKOS.hasTopConcept}> <${concept}> . } }`;

	it('insertConcept writes the inverse for a top concept and none otherwise', async () => {
		const top = mockFetch();
		vi.stubGlobal('fetch', top.fn);
		await connector().insertConcept(CORE, draft);
		expect(top.updates).toHaveLength(1);
		expect(top.updates[0]).toContain(`<${SKOS.topConceptOf}> <${draft.schemeIri}>`);
		expect(top.updates[0]).toMatch(new RegExp(`<${draft.schemeIri}> <${SKOS.hasTopConcept}> <[^>]+BankFinance>`));

		const plain = mockFetch();
		vi.stubGlobal('fetch', plain.fn);
		await connector().insertConcept(CORE, { ...draft, topConcept: false });
		expect(plain.updates[0]).not.toContain(SKOS.hasTopConcept);
	});

	it('updateConcept replaces the inverse in the same update', async () => {
		const top = mockFetch({ exists: true });
		vi.stubGlobal('fetch', top.fn);
		await connector().updateConcept(CORE, concept, draft);
		expect(top.updates).toHaveLength(1);
		expect(top.updates[0]).toContain(dropInverse);
		expect(top.updates[0]).toContain(`${inverse} .`);

		const un = mockFetch({ exists: true });
		vi.stubGlobal('fetch', un.fn);
		await connector().updateConcept(CORE, concept, { ...draft, topConcept: false });
		expect(un.updates[0]).toContain(dropInverse);
		expect(un.updates[0]).not.toContain(`${inverse} .`);
	});

	it('moving a concept to another scheme drops the old inverse and writes the new one', async () => {
		const m = mockFetch({ exists: true });
		vi.stubGlobal('fetch', m.fn);
		const other = `${VOCAB}#Other`;
		await connector().updateConcept(CORE, concept, { ...draft, schemeIri: other });
		expect(m.updates[0]).toContain(dropInverse);
		expect(m.updates[0]).toContain(`<${other}> <${SKOS.hasTopConcept}> <${concept}> .`);
	});

	it('setTopConcept writes both triples when marking and removes both when clearing', async () => {
		const on = mockFetch({ select: () => [{ s: { value: draft.schemeIri } }] });
		vi.stubGlobal('fetch', on.fn);
		await connector().setTopConcept(CORE, concept, true);
		expect(on.updates).toHaveLength(1);
		expect(on.updates[0]).toContain(dropInverse);
		expect(on.updates[0]).toContain(`<${concept}> <${SKOS.topConceptOf}> <${draft.schemeIri}>`);
		expect(on.updates[0]).toContain(`${inverse} .`);

		const off = mockFetch();
		vi.stubGlobal('fetch', off.fn);
		await connector().setTopConcept(CORE, concept, false);
		expect(off.updates).toHaveLength(1);
		expect(off.updates[0]).toContain(dropInverse);
		expect(off.updates[0]).toContain(`<${concept}> <${SKOS.topConceptOf}> ?s`);
		expect(off.updates[0]).not.toContain(`${inverse} .`);
	});

	it('deleteConcept removes the inverse too', async () => {
		const m = mockFetch();
		vi.stubGlobal('fetch', m.fn);
		await connector().deleteConcept(CORE, concept);
		expect(m.updates).toHaveLength(1);
		expect(m.updates[0]).toContain(dropInverse);
	});

	it('ensureHasTopConcept inserts the missing inverses in one update, once per connector', async () => {
		const m = mockFetch({ exists: true });
		vi.stubGlobal('fetch', m.fn);
		const c = connector();
		await c.ensureHasTopConcept(CORE);
		expect(m.updates).toHaveLength(1);
		expect(m.updates[0]).toContain(`?s <${SKOS.hasTopConcept}> ?c`);
		expect(m.updates[0]).toContain(`?c <${SKOS.topConceptOf}> ?s`);
		expect(m.updates[0]).toContain('FILTER NOT EXISTS');
		await c.ensureHasTopConcept(CORE);
		expect(m.updates).toHaveLength(1);
	});

	it('ensureHasTopConcept writes nothing when no inverse is missing', async () => {
		const m = mockFetch({ exists: false });
		vi.stubGlobal('fetch', m.fn);
		await connector().ensureHasTopConcept(CORE);
		expect(m.updates).toHaveLength(0);
	});
});

describe('SparqlConnector.countConceptsByScheme (STORY-448)', () => {
	afterEach(() => vi.unstubAllGlobals());
	it('counts the concepts per scheme in one query; concepts without a scheme are under the empty key', async () => {
		const { fn, queries } = mockFetch({
			select: () => [
				{ s: { value: `${VOCAB}#A` }, n: { value: '12' } },
				{ s: { value: `${VOCAB}#B` }, n: { value: '3' } },
				{ n: { value: '2' } }
			]
		});
		vi.stubGlobal('fetch', fn);
		const counts = await connector().countConceptsByScheme(CORE);
		expect(counts).toEqual({ [`${VOCAB}#A`]: 12, [`${VOCAB}#B`]: 3, '': 2 });
		expect(queries).toHaveLength(1);
		expect(queries[0]).toContain('GROUP BY ?s');
		expect(queries[0]).toContain(`FROM <${VOCAB}>`);
	});
});
