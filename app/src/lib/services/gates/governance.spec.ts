import { describe, expect, it } from 'vitest';
import type { FetchedSchema } from '../sparql-connector';
import { runGates } from './index';
import { GOVERNANCE_GATES } from './governance';

const schema = { classes: [], subClassOf: [] } as unknown as FetchedSchema;
const NS = 'http://example.org/core';
const run = (governance: unknown) => runGates(schema, { governance: governance as never, stages: ['governance'] });

describe('governance gate (STORY-331)', () => {
	it('registers under the governance stage', () => {
		expect(GOVERNANCE_GATES.every((g) => g.stage === 'governance')).toBe(true);
	});

	it('is silent without a core namespace', () => {
		expect(run(undefined)).toEqual([]);
		expect(run(null)).toEqual([]);
	});

	it('reports what a core namespace lacks', () => {
		const found = run({ namespaceIri: NS, steward: '', authority: 'Data Office', maturity: '', version: '' });
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ gateId: 'governance-incomplete', severity: 'warning', elementIri: NS });
		expect(found[0].message).toContain('steward');
		expect(found[0].message).toContain('version');
		expect(found[0].message).not.toContain('authority');
	});

	it('is quiet for a complete core namespace', () => {
		expect(run({ namespaceIri: NS, steward: 'Ann', authority: 'Data Office', maturity: 'pilot', version: '1.0.0' })).toEqual([]);
	});
});
