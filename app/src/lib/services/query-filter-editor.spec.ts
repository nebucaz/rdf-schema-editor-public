import { describe, it, expect } from 'vitest';
import {
	operatorsForProperty,
	OPERATORS_FOR_ENTITY,
	validateFilterValue,
	makeFilter,
	prefillFromFilters,
	describeFilter
} from './query-filter-editor';
import { updateFilter, startQueryFromClass, addFilter } from './query-model-edit';
import { validateQueryModel } from './query-model';
import type { BuilderProperty } from './query-builder-schema';
import type { Filter } from './query-model';

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const NS = 'http://example.org/ns';
const prop = (datatype: string, extra: Partial<BuilderProperty> = {}): BuilderProperty => ({
	iri: `${NS}#p`, label: 'P', datatype, required: false, repeatable: false, ...extra
});

describe('operatorsForProperty', () => {
	it('strings get eq/neq/contains/isEmpty/isNotEmpty', () => {
		expect(operatorsForProperty(prop(`${XSD}string`))).toEqual(['eq', 'neq', 'contains', 'isEmpty', 'isNotEmpty']);
	});
	it('enumerations get eq/in only, whatever the datatype', () => {
		const p = prop(`${XSD}string`, { allowedValues: [{ value: 'A', label: 'A', isIri: false }] });
		expect(operatorsForProperty(p)).toEqual(['eq', 'in']);
	});
	it('numbers, booleans and dates have no substring operator', () => {
		for (const dt of ['integer', 'decimal', 'boolean', 'date', 'dateTime']) {
			const ops = operatorsForProperty(prop(`${XSD}${dt}`));
			expect(ops).not.toContain('contains');
			expect(ops).toContain('eq');
		}
	});
	it('related entities only allow eq', () => {
		expect(OPERATORS_FOR_ENTITY).toEqual(['eq']);
	});
});

describe('validateFilterValue', () => {
	it.each([
		['integer', 'abc', true], ['integer', '42', false], ['integer', '4.2', true],
		['decimal', '4.2', false], ['decimal', 'x', true],
		['boolean', 'true', false], ['boolean', 'yes', true],
		['date', '2024-03-01', false], ['date', '01/03/2024', true],
		['dateTime', '2024-03-01T10:00:00Z', false], ['dateTime', 'tomorrow', true],
		['string', 'anything', false]
	])('%s %j → error? %s', (dt, value, hasError) => {
		const err = validateFilterValue(`${XSD}${dt}`, value);
		expect(err !== null).toBe(hasError);
	});
	it('unknown datatypes are not rejected', () => {
		expect(validateFilterValue('http://example.org/custom', 'whatever')).toBeNull();
	});
	it('an empty value is an error', () => {
		expect(validateFilterValue(`${XSD}string`, '  ')).not.toBeNull();
	});
});

describe('makeFilter', () => {
	const p = prop(`${XSD}integer`);
	it('builds the expected Filter for each operator', () => {
		expect(makeFilter({ hopId: null, property: p, op: 'eq', value: '3' })).toEqual({
			ok: true, filter: { hopId: null, propertyIri: p.iri, op: 'eq', value: '3' }
		});
		expect(makeFilter({ hopId: 'h1', property: p, op: 'isEmpty' })).toEqual({
			ok: true, filter: { hopId: 'h1', propertyIri: p.iri, op: 'isEmpty' }
		});
		const en = prop(`${XSD}string`, { allowedValues: [{ value: 'A', label: 'A', isIri: false }] });
		expect(makeFilter({ hopId: null, property: en, op: 'in', values: ['A', 'B'] })).toEqual({
			ok: true, filter: { hopId: null, propertyIri: p.iri, op: 'in', value: ['A', 'B'] }
		});
	});
	it('rejects typed input that does not parse, before it reaches the model', () => {
		const r = makeFilter({ hopId: null, property: p, op: 'eq', value: 'abc' });
		expect(r.ok).toBe(false);
	});
	it('rejects an operator not offered for the property', () => {
		expect(makeFilter({ hopId: null, property: p, op: 'contains', value: '3' }).ok).toBe(false);
	});
	it('rejects an empty `in` list', () => {
		const en = prop(`${XSD}string`, { allowedValues: [{ value: 'A', label: 'A', isIri: false }] });
		expect(makeFilter({ hopId: null, property: en, op: 'in', values: [] }).ok).toBe(false);
	});
	it('builds a related-entity filter on the entity IRI, not its label', () => {
		const r = makeFilter({ hopId: 'h1', entity: { iri: `${NS}#SAP`, label: 'SAP' } });
		expect(r).toEqual({ ok: true, filter: { hopId: 'h1', propertyIri: null, op: 'eq', value: `${NS}#SAP` } });
	});
});

describe('updateFilter', () => {
	it('patches one filter immutably and keeps the model valid', () => {
		const m0 = addFilter(startQueryFromClass(`${NS}#A`, [NS]), {
			hopId: null, propertyIri: `${NS}#p`, op: 'eq', value: 'x'
		});
		const id = m0.filters[0].id;
		const m1 = updateFilter(m0, id, { op: 'neq', value: 'y' });
		expect(m1.filters[0]).toMatchObject({ id, op: 'neq', value: 'y', propertyIri: `${NS}#p` });
		expect(m0.filters[0]).toMatchObject({ op: 'eq', value: 'x' });
		expect(validateQueryModel(m1)).toEqual([]);
	});
});

describe('describeFilter', () => {
	it('renders a chip label', () => {
		expect(describeFilter({ id: 'f1', hopId: null, propertyIri: `${NS}#lifecycle`, op: 'eq', value: 'Production' }, 'Lifecycle'))
			.toBe('Lifecycle = Production');
		expect(describeFilter({ id: 'f2', hopId: null, propertyIri: `${NS}#x`, op: 'isEmpty' }, 'X')).toBe('X is empty');
		expect(describeFilter({ id: 'f3', hopId: null, propertyIri: `${NS}#x`, op: 'in', value: ['a', 'b'] }, 'X')).toBe('X in (a, b)');
	});
});

describe('prefillFromFilters', () => {
	const f = (op: Filter['op'], value?: Filter['value'], id = op): Filter => ({
		id, hopId: null, propertyIri: `${NS}#p`, op, ...(value === undefined ? {} : { value })
	});

	it('gives empty defaults when nothing is filtered', () => {
		expect(prefillFromFilters([])).toEqual({ range: false, op: null, value: '', values: [], from: '', to: '' });
	});

	it('pre-fills a single comparison', () => {
		expect(prefillFromFilters([f('contains', 'ab')])).toMatchObject({ range: false, op: 'contains', value: 'ab' });
		expect(prefillFromFilters([f('isEmpty')])).toMatchObject({ range: false, op: 'isEmpty', value: '' });
	});

	it('pre-fills an `in` filter with its values', () => {
		expect(prefillFromFilters([f('in', ['A', 'B'])])).toMatchObject({ op: 'in', values: ['A', 'B'] });
	});

	it('reads a gte + lt pair as one range, and an open-ended bound as a range too', () => {
		expect(prefillFromFilters([f('gte', '1'), f('lt', '9')])).toMatchObject({ range: true, from: '1', to: '9' });
		expect(prefillFromFilters([f('gte', '1')])).toMatchObject({ range: true, from: '1', to: '' });
		expect(prefillFromFilters([f('lt', '9')])).toMatchObject({ range: true, from: '', to: '9' });
	});

	it('falls back to the first filter when the set is not a plain range', () => {
		expect(prefillFromFilters([f('gt', '5'), f('lte', '8')])).toMatchObject({ range: false, op: 'gt', value: '5' });
	});
});
