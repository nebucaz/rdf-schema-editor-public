import { describe, expect, it } from 'vitest';
import type { Concept } from '#lib/services/skos-concept.js';
import type { FetchedSchema } from '#lib/services/sparql-connector.js';
import { GATES, runGates } from '#lib/services/gates/index.js';
import { lintLabel } from '#lib/services/gates/vocabulary.js';
import { docSections } from './manifest';

/** process-description STORY-339: the worked example is checked against the real gates, so following the guides
 *  with it produces a clean Gate report. */
const section = docSections.find((s) => s.id === 'pipeline-example');
const text = section?.content ?? '';

/** The rows of the first table that follows the heading containing `heading`, without header and divider. */
function tableAfter(heading: string): string[][] {
	const lines = text.split('\n');
	const start = lines.findIndex((l) => l.startsWith('#') && l.includes(heading));
	if (start < 0) return [];
	const rows: string[][] = [];
	let inTable = false;
	for (const line of lines.slice(start + 1)) {
		if (line.trim().startsWith('|')) {
			inTable = true;
			rows.push(line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
		} else if (inTable) break;
	}
	return rows.slice(2);
}

const SCHEME = 'urn:example:it-landscape';
const iriOf = (label: string, qualifier = '') => `urn:example:${label}${qualifier ? `-${qualifier}` : ''}`.toLowerCase().replace(/\s+/g, '-');
const terms = tableAfter('The terms');
const byLabel = new Map(terms.map(([label, q]) => [label, iriOf(label, q)] as const));

const concepts: Concept[] = terms.map(([label, qualifier, alts, definition, broader]) => {
	const related = tableAfter('Related terms').filter(([from]) => from === label).map(([, to]) => byLabel.get(to)!);
	return {
		iri: iriOf(label, qualifier),
		prefLabels: [{ text: label, lang: 'en' }],
		altLabels: alts ? alts.split(',').map((t) => ({ text: t.trim(), lang: 'en' })) : [],
		hiddenLabels: [],
		definition,
		scopeNote: '',
		disambiguation: qualifier,
		schemeIri: SCHEME,
		topConcept: broader === '—',
		status: 'active',
		source: 'Architecture board glossary',
		authority: 'Enterprise Architecture',
		replacedBy: '',
		deprecationReason: '',
		created: '',
		modified: '',
		deprecatedOn: '',
		broader: broader === '—' ? [] : [byLabel.get(broader)!],
		related,
		mappings: []
	};
});

// The mapping table follows the related table under the same heading, so read it by its header.
const mappingRows = (() => {
	const lines = text.split('\n');
	const head = lines.findIndex((l) => l.includes('| Concept | Mapping | Target |'));
	const body = lines.slice(head + 2);
	const end = body.findIndex((l) => !l.trim().startsWith('|'));
	return body
		.slice(0, end < 0 ? undefined : end)
		.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
})();
for (const [label, kind, target] of mappingRows) {
	const c = concepts.find((x) => x.prefLabels[0].text === label && !x.disambiguation);
	c?.mappings?.push({ kind: kind as 'closeMatch', target });
}

const schema = { classes: [], subClassOf: [] } as unknown as FetchedSchema;

describe('worked example: registration', () => {
	it('is registered in the Ontology Pipeline category after the governance sheet', () => {
		expect(section).toBeDefined();
		expect(section?.category).toBe('Ontology Pipeline');
		expect(section!.order).toBeGreaterThan(docSections.find((s) => s.id === 'pipeline-governance')!.order);
	});

	it('says it is invented and does not use the book as its source', () => {
		expect(text).toMatch(/invented/i);
	});
});

describe('worked example: content', () => {
	it('has a scope record with purpose, decisions, out of scope and stakeholders', () => {
		for (const field of ['Purpose', 'Decisions supported', 'Out of scope', 'Stakeholders']) expect(text).toContain(`| ${field} |`);
	});

	it('has about a dozen terms, with a synonym, an acronym, a homonym and a rejected catch-all', () => {
		expect(terms.length).toBeGreaterThanOrEqual(12);
		expect(terms.length).toBeLessThanOrEqual(15);
		expect(concepts.some((c) => c.altLabels.some((l) => l.text === 'System owner'))).toBe(true);
		expect(concepts.some((c) => c.altLabels.some((l) => l.text === 'API'))).toBe(true);
		const services = concepts.filter((c) => c.prefLabels[0].text === 'Service');
		expect(services.map((c) => c.disambiguation).sort()).toEqual(['business', 'technical']);
		expect(text).toMatch(/Other systems.*Rejected/);
	});

	it('has three competency questions, a shape, individuals and a change request that ends in a minor version', () => {
		expect(tableAfter('Competency questions')).toHaveLength(3);
		for (const [, question] of tableAfter('Competency questions')) expect(question).toMatch(/\?$/);
		expect(text).toMatch(/## 7\. A shape/);
		expect(tableAfter('A few individuals').length).toBeGreaterThanOrEqual(3);
		expect(text).toMatch(/1\.2\.0.*1\.3\.0.*minor/s);
	});

	it('has related links across branches and two mappings to another scheme', () => {
		const related = tableAfter('Related terms');
		expect(related).toHaveLength(2);
		expect(mappingRows).toHaveLength(2);
		for (const [, , target] of mappingRows) expect(target.startsWith('https://example.org/')).toBe(true);
	});
});

describe('worked example: clean against the gates', () => {
	it('every label passes the label-style rules', () => {
		for (const c of concepts) {
			for (const l of [...c.prefLabels, ...c.altLabels]) expect(lintLabel(l.text), l.text).toEqual([]);
		}
	});

	it('the Gate report for the example has no finding', () => {
		const findings = runGates(schema, { concepts, stages: ['vocabulary', 'taxonomy', 'thesaurus'] }, GATES);
		expect(findings.map((f) => `${f.gateId}: ${f.message}`)).toEqual([]);
	});

	it('the taxonomy is at most three levels deep and every broader concept exists', () => {
		const depth = (c: Concept): number => (c.broader?.length ? 1 + depth(concepts.find((x) => x.iri === c.broader![0])!) : 1);
		expect(Math.max(...concepts.map(depth))).toBeLessThanOrEqual(3);
		for (const c of concepts) for (const b of c.broader ?? []) expect(concepts.some((x) => x.iri === b)).toBe(true);
	});

	it('the taxonomy list names every term', () => {
		const section4 = text.slice(text.indexOf('## 4. The taxonomy'), text.indexOf('## 5.'));
		for (const [label, q] of terms) expect(section4).toContain(q ? `${label} (${q})` : label);
	});
});
