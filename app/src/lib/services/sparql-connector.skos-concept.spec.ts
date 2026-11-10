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
				scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' }
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

		expect(result).toEqual({ deleted: false, linkedClasses: ['http://example.org/a#Bank'], narrower: [`${VOCAB}#Savings`] });
		expect(updates).toHaveLength(0);
		const classQuery = queries.find((q) => q.includes(CLASS_DEFINED_BY_CONCEPT_PREDICATE_IRI))!;
		expect(classQuery).toMatch(/SELECT DISTINCT/);
	});

	it('deletes directly when nothing references the concept', async () => {
		const { fn, updates } = mockFetch();
		vi.stubGlobal('fetch', fn);
		expect(await connector().deleteConcept(CORE, iri)).toEqual({ deleted: true, linkedClasses: [], narrower: [] });
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
