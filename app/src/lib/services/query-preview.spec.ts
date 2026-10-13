import { describe, it, expect } from 'vitest';
import { describeQueryOutput } from './query-preview';
import { buildBuilderSchema } from './query-builder-schema';
import { startQueryFromClass, addColumn } from './query-model-edit';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;
const schema = buildBuilderSchema({
	classes: [{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS }],
	datatypeProperties: [], objectProperties: [], subClassOf: [], individuals: [],
	individualClassRelations: [], individualIndividualRelations: []
} as FetchedSchema);

describe('describeQueryOutput', () => {
	it('returns SPL and un-paged SPARQL for a valid model', () => {
		const m = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'Name' });
		const out = describeQueryOutput(m, schema);
		expect(out.ok).toBe(true);
		if (out.ok) {
			expect(out.spl).toContain('Application');
			expect(out.spl).toContain('| fields');
			expect(out.sparql).toContain('SELECT DISTINCT');
			expect(out.sparql).not.toMatch(/LIMIT/);
		}
	});

	it('updates with the model', () => {
		const m1 = addColumn(startQueryFromClass(APP, [NS]), { hopId: null, source: 'label', header: 'Name' });
		const m2 = addColumn(m1, { hopId: null, source: 'iri', header: 'IRI' });
		const a = describeQueryOutput(m1, schema);
		const b = describeQueryOutput(m2, schema);
		expect(a.ok && b.ok && a.sparql !== b.sparql).toBe(true);
	});

	it('returns messages instead of output for an invalid model', () => {
		const out = describeQueryOutput(startQueryFromClass(APP, [NS]), schema);
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.messages.join(' ')).toMatch(/at least one column/i);
	});

	it('reports an unknown root class as a message, never throws', () => {
		const m = addColumn(startQueryFromClass(`${NS}#Gone`, [NS]), { hopId: null, source: 'label', header: 'N' });
		const out = describeQueryOutput(m, schema);
		expect(out.ok).toBe(false);
	});
});
