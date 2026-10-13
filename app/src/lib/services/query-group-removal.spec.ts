import { describe, expect, it } from 'vitest';
import { groupRemovalSummary, isDestructive } from './query-group-removal';
import { addColumn, addFilter, addHop, enableAggregation, addMeasure, setSort } from './query-model-edit';
import { emptyQueryModel, type QueryModel } from './query-model';

const R = 'http://example.org#Org';
const T = 'http://example.org#Team';
const P = 'http://example.org#Person';

function model(): QueryModel {
	let m = emptyQueryModel(R, []);
	m = addHop(m, null, { iri: 'http://example.org#hasTeam', targetClassIri: T });
	m = addHop(m, 'h1', { iri: 'http://example.org#hasMember', targetClassIri: P });
	m = addColumn(m, { hopId: null, source: 'label', header: 'Org' });
	m = addColumn(m, { hopId: 'h1', source: 'label', header: 'Team' });
	m = addColumn(m, { hopId: 'h2', source: 'label', header: 'Person' });
	m = addFilter(m, { hopId: 'h1', propertyIri: null, op: 'eq', value: 'http://example.org#t1' });
	m = addFilter(m, { hopId: null, propertyIri: 'http://example.org#name', op: 'contains', value: 'a' });
	m = setSort(m, 'c2', 'asc');
	return m;
}

describe('groupRemovalSummary', () => {
	it('counts what removing a group cascades over, descendants included', () => {
		const s = groupRemovalSummary(model(), 'h1');
		expect(s.blockedReason).toBeNull();
		expect(s).toMatchObject({ groups: 2, columns: 2, filters: 1, sortKeys: 1, measures: 0 });
		expect(isDestructive(s)).toBe(true);
	});

	it('is not destructive for a leaf group with nothing attached', () => {
		let m = addHop(emptyQueryModel(R, []), null, { iri: 'http://example.org#hasTeam', targetClassIri: T });
		m = addColumn(m, { hopId: null, source: 'label', header: 'Org' });
		const s = groupRemovalSummary(m, 'h1');
		expect(s).toMatchObject({ groups: 1, columns: 0, filters: 0, sortKeys: 0, measures: 0 });
		expect(isDestructive(s)).toBe(false);
	});

	it('counts measures that cannot survive losing their column', () => {
		let m = model();
		m = enableAggregation(m);
		m = addMeasure(m, 'max', 'c3');
		expect(groupRemovalSummary(m, 'h2').measures).toBe(1);
	});

	it('blocks removing the root while child groups exist', () => {
		const s = groupRemovalSummary(model(), null);
		expect(s.blockedReason).toMatch(/remove the groups below it first/i);
	});

	it('allows removing a childless root', () => {
		const s = groupRemovalSummary(emptyQueryModel(R, []), null);
		expect(s.blockedReason).toBeNull();
	});
});
