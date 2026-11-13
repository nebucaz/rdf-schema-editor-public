import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Keeps `examples/itam-shapes/RUNBOOK.md` and `spec/shacl-test/shape-findings.md` honest (STORY-360):
 * every record and rule id they name exists, and the runbook's findings table is the expected table.
 */

const dir = fileURLToPath(new URL('../../../../examples/itam-shapes/', import.meta.url));
const read = (name: string) => readFileSync(dir + name, 'utf8');
const runbook = read('RUNBOOK.md');
const findingsDoc = readFileSync(fileURLToPath(new URL('../../../../spec/shacl-test/shape-findings.md', import.meta.url)), 'utf8');
const data = read('itam-data.ttl');
const expected = JSON.parse(read('itam-expected.json')) as {
	findings: { individual: string; ruleId: string; constraint: string; path: string; engine: string }[];
};
const shapeIds = new Set(
	readdirSync(dir)
		.filter((f) => /^AC-.*\.ttl$/.test(f))
		.flatMap((f) => [...read(f).matchAll(/arm-s:id\s+"([^"]+)"/g)].map((m) => m[1]))
);
const dataRecords = new Set([...data.matchAll(/^arm:(R\d\d)\s*$/gm)].map((m) => m[1]));

const findingRows = [...runbook.matchAll(/^\| (R\d\d) \| (AC-[A-Z-]+) \| (\w+) \| (\w+) \| ([^|]+) \|$/gm)].map((m) => ({
	record: m[1],
	ruleId: m[2],
	constraint: m[3],
	path: m[4],
	engine: m[5].trim().startsWith('SPARQL') ? 'sparql' : 'inMemory'
}));

describe('ITAM runbook (STORY-360)', () => {
	it('lists the 22 expected findings exactly as itam-expected.json', () => {
		const fromJson = expected.findings.map((f) => ({
			record: f.individual.split('#')[1],
			ruleId: f.ruleId,
			constraint: f.constraint,
			path: f.path.split('#')[1],
			engine: f.engine
		}));
		expect(findingRows).toHaveLength(22);
		expect(findingRows).toEqual(fromJson);
	});

	it('names only records that exist in itam-data.ttl and lists all 23', () => {
		expect(dataRecords.size).toBe(23);
		const recordRows = [...runbook.matchAll(/^\| (R\d\d) \| [^|]+ \| [^|]+ \|$/gm)].map((m) => m[1]);
		expect(new Set(recordRows)).toEqual(dataRecords);
		for (const row of findingRows) expect(dataRecords.has(row.record)).toBe(true);
	});

	it('uses only rule ids that exist in the shape files', () => {
		for (const id of new Set(findingRows.map((r) => r.ruleId))) expect(shapeIds.has(id)).toBe(true);
	});

	it('names the import order and every shape file', () => {
		for (const f of readdirSync(dir).filter((n) => /^(AC-.*|itam-(schema|data))\.ttl$/.test(n))) {
			expect(runbook).toContain(f);
		}
		expect(runbook.indexOf('itam-schema.ttl')).toBeLessThan(runbook.indexOf('itam-data.ttl'));
	});

	it('states which findings only the human run covers', () => {
		expect(runbook).toContain('Only here');
		const sparql = expected.findings.filter((f) => f.engine === 'sparql').length;
		expect(sparql).toBe(15);
		expect(runbook).toContain('| `sh:sparql` | 15 |');
	});
});

describe('shape findings (STORY-360)', () => {
	it('has one section per suspected defect with a GraphDB result field', () => {
		const sections = findingsDoc.split(/^## /m).slice(1);
		expect(sections).toHaveLength(5);
		for (const s of sections) {
			expect(s).toContain('**Expected from code reading:**');
			expect(s).toContain('**GraphDB result:**');
		}
	});

	it('refers only to rule ids and shape files that exist', () => {
		const fileStems = new Set(readdirSync(dir).filter((f) => /^AC-.*\.ttl$/.test(f)).map((f) => f.replace(/\.ttl$/, '')));
		for (const id of new Set(findingsDoc.match(/AC-[A-Z]+(?:-[A-Z]+)*/g) ?? [])) {
			expect(shapeIds.has(id) || fileStems.has(id), id).toBe(true);
		}
		expect(shapeIds.has('AC-TECHID-EXIST')).toBe(true);
		expect(fileStems.has('AC-TECHID-EXISTS')).toBe(true);
	});
});
