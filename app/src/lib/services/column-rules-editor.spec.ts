import { describe, it, expect } from 'vitest';
import {
	addRule,
	removeRule,
	moveRule,
	moveRuleWithinColumn,
	updateRule,
	rulesForColumn,
	enumerationValuesForColumn,
	cellRuleColor
} from './column-rules-editor';
import type { ColumnRule } from './column-rules';
import { emptyQueryModel, type QueryModel } from './query-model';
import { removeColumn, addColumn, removeHop } from './query-model-edit';
import { buildBuilderSchema } from './query-builder-schema';
import type { FetchedSchema } from './sparql-connector';

const NS = 'http://example.org/ns';
const APP = `${NS}#Application`;

const green: ColumnRule = { columnId: 'c1', match: { op: 'eq', value: 'Production' }, color: 'green' };
const red: ColumnRule = { columnId: 'c1', match: { op: 'contains', value: 'Prod' }, color: 'red' };
const other: ColumnRule = { columnId: 'c2', match: { op: 'isEmpty' }, color: 'grey' };

describe('rule list editing', () => {
	it('addRule appends and does not mutate', () => {
		const before: ColumnRule[] = [green];
		const after = addRule(before, red);
		expect(after).toEqual([green, red]);
		expect(before).toEqual([green]);
		expect(addRule(undefined, green)).toEqual([green]);
	});

	it('removeRule drops by index and ignores out-of-range', () => {
		expect(removeRule([green, red], 0)).toEqual([red]);
		expect(removeRule([green], 5)).toEqual([green]);
	});

	it('moveRule reorders (first match wins) and is a no-op at the ends', () => {
		expect(moveRule([green, red], 1, -1)).toEqual([red, green]);
		expect(moveRule([green, red], 0, -1)).toEqual([green, red]);
		expect(moveRule([green, red], 1, 1)).toEqual([green, red]);
	});

	it('moveRule order changes the outcome when rules overlap', () => {
		expect(cellRuleColor([green, red], { columnId: 'c1', text: 'Production', rawValue: 'Production' })).toBe('green');
		expect(cellRuleColor(moveRule([green, red], 1, -1), { columnId: 'c1', text: 'Production', rawValue: 'Production' })).toBe('red');
	});

	it('updateRule replaces one entry', () => {
		expect(updateRule([green, red], 1, { ...red, color: 'amber' })[1].color).toBe('amber');
	});

	it('rulesForColumn keeps the global index so the editor can address the full list', () => {
		expect(rulesForColumn([green, other, red], 'c1')).toEqual([
			{ index: 0, rule: green },
			{ index: 2, rule: red }
		]);
	});
});

describe('moveRuleWithinColumn', () => {
	const c1b: ColumnRule = { columnId: 'c1', match: { op: 'isEmpty' }, color: 'grey' };

	it('swaps with the neighbouring rule of the same column, skipping other columns', () => {
		// order: green(c1), other(c2), red(c1) — moving red earlier must pass green, leaving other put
		expect(moveRuleWithinColumn([green, other, red], 2, -1)).toEqual([red, other, green]);
		expect(moveRuleWithinColumn([green, other, red], 0, 1)).toEqual([red, other, green]);
	});

	it('is a no-op at the first/last rule of the column', () => {
		expect(moveRuleWithinColumn([green, other, red], 0, -1)).toEqual([green, other, red]);
		expect(moveRuleWithinColumn([green, other, c1b], 2, 1)).toEqual([green, other, c1b]);
		expect(moveRuleWithinColumn([green, other], 1, -1)).toEqual([green, other]);
	});
});

describe('cellRuleColor', () => {
	it('matches the displayed text, falling back to the raw value', () => {
		const iriRule: ColumnRule = { columnId: 'c1', match: { op: 'eq', value: `${NS}#Prod` }, color: 'blue' };
		expect(cellRuleColor([iriRule], { columnId: 'c1', text: 'Prod', rawValue: `${NS}#Prod` })).toBe('blue');
		expect(cellRuleColor([green], { columnId: 'c1', text: '', rawValue: '' })).toBeUndefined();
		expect(cellRuleColor([other], { columnId: 'c2', text: '', rawValue: '' })).toBe('grey');
	});
});

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const fetched = (): FetchedSchema =>
	({
		classes: [
			{ iri: APP, label: 'Application', comment: null, namespaceBaseIri: NS },
			{ iri: `${NS}#Lifecycle`, label: 'Lifecycle', comment: null, namespaceBaseIri: NS }
		],
		datatypeProperties: [
			{ iri: `${NS}#tier`, label: 'Tier', domain: APP, range: XSD_STRING, namespaceBaseIri: NS, required: false, repeatable: false },
			{ iri: `${NS}#name`, label: 'Name', domain: APP, range: XSD_STRING, namespaceBaseIri: NS, required: false, repeatable: false }
		],
		objectProperties: [],
		subClassOf: [],
		individuals: [
			{ iri: `${NS}#Prod`, label: 'Production', classIri: `${NS}#Lifecycle` },
			{ iri: `${NS}#Dev`, label: 'Development', classIri: `${NS}#Lifecycle` }
		],
		individualClassRelations: [],
		individualIndividualRelations: [],
		shapeInConstraints: [
			{
				classIri: APP,
				propertyIri: `${NS}#tier`,
				values: [
					{ value: 'Gold', isIri: false },
					{ value: 'Silver', isIri: false }
				]
			}
		]
	}) as unknown as FetchedSchema;

describe('enumerationValuesForColumn', () => {
	const built = buildBuilderSchema(fetched());

	it('offers the members of an enumeration class for its label column', () => {
		let model: QueryModel = emptyQueryModel(`${NS}#Lifecycle`, [NS]);
		model = addColumn(model, { hopId: null, source: 'label', header: 'Lifecycle' });
		const values = enumerationValuesForColumn(model, built, model.columns[0]);
		expect(values?.map((v) => v.label).sort()).toEqual(['Development', 'Production']);
	});

	it('offers a property\'s sh:in values', () => {
		let model: QueryModel = emptyQueryModel(APP, [NS]);
		model = addColumn(model, { hopId: null, source: { propertyIri: `${NS}#tier` }, header: 'Tier' });
		const values = enumerationValuesForColumn(model, built, model.columns[0]);
		expect(values?.map((v) => v.value)).toEqual(['Gold', 'Silver']);
	});

	it('returns undefined for a plain free-text column', () => {
		let model: QueryModel = emptyQueryModel(APP, [NS]);
		model = addColumn(model, { hopId: null, source: { propertyIri: `${NS}#name` }, header: 'Name' });
		expect(enumerationValuesForColumn(model, built, model.columns[0])).toBeUndefined();
	});
});

describe('model edits keep rules consistent', () => {
	it('removeColumn drops that column\'s rules', () => {
		let model: QueryModel = emptyQueryModel(APP, [NS]);
		model = addColumn(model, { hopId: null, source: 'label', header: 'Name' });
		model = addColumn(model, { hopId: null, source: 'iri', header: 'IRI' });
		model = { ...model, columnRules: [green, other] };
		const next = removeColumn(model, 'c1');
		expect(next.columnRules).toEqual([other]);
	});

	it('removeColumn leaves a model without rules unchanged in shape', () => {
		let model: QueryModel = emptyQueryModel(APP, [NS]);
		model = addColumn(model, { hopId: null, source: 'label', header: 'Name' });
		expect(removeColumn(model, 'c1').columnRules).toBeUndefined();
	});

	it('removeHop drops rules of the columns it removes', () => {
		let model: QueryModel = emptyQueryModel(APP, [NS]);
		model = {
			...model,
			hops: [{ id: 'h1', parentHopId: null, propertyIri: `${NS}#lifecycle`, direction: 'forward', targetClassIri: `${NS}#Lifecycle` }]
		};
		model = addColumn(model, { hopId: 'h1', source: 'label', header: 'Lifecycle' });
		model = { ...model, columnRules: [green] };
		expect(removeHop(model, 'h1').columnRules).toEqual([]);
	});
});
