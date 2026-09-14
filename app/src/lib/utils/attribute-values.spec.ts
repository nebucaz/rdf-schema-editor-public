import { describe, it, expect } from 'vitest';
import {
	emptyAttributeFormValues,
	mergeAttributeFormValues,
	validateRequiredAttributes,
	reconcileAttributeValues,
	type AttributeSpecLike
} from './attribute-values';

function attr(iri: string, overrides: Partial<AttributeSpecLike> = {}): AttributeSpecLike {
	return { iri, datatype: 'string', required: false, repeatable: false, ...overrides };
}

describe('emptyAttributeFormValues', () => {
	it('seeds an empty string for single-valued attributes and an empty array for repeatable ones', () => {
		const values = emptyAttributeFormValues([attr('a'), attr('b', { repeatable: true })]);
		expect(values).toEqual({ a: '', b: [] });
	});
});

describe('mergeAttributeFormValues', () => {
	it('fills in defaults for attributes the fetch returned nothing for', () => {
		const values = mergeAttributeFormValues([attr('a'), attr('b', { repeatable: true })], {});
		expect(values).toEqual({ a: '', b: [] });
	});

	it('carries a fetched single value through for a non-repeatable attribute', () => {
		const values = mergeAttributeFormValues([attr('a')], { a: '1990-01-01' });
		expect(values).toEqual({ a: '1990-01-01' });
	});

	it('carries fetched values through as an array for a repeatable attribute', () => {
		const values = mergeAttributeFormValues([attr('a', { repeatable: true })], { a: ['Al', 'Ally'] });
		expect(values).toEqual({ a: ['Al', 'Ally'] });
	});

	it('wraps a single fetched value into an array for a repeatable attribute', () => {
		const values = mergeAttributeFormValues([attr('a', { repeatable: true })], { a: 'Al' });
		expect(values).toEqual({ a: ['Al'] });
	});

	it('never reuses the fetched array reference for a repeatable attribute', () => {
		// Regression: `MemberForm.svelte` runs `structuredClone` on this function's return value, and
		// the caller's array may be a Svelte 5 `$state` reactive proxy (e.g.
		// `IdentityResourcePage.svelte`'s `editAttributeValues`) — reusing that reference instead of
		// copying it used to leak the proxy through and throw `DataCloneError` for any repeatable
		// attribute with an existing value.
		const fetchedTags = ['go', 'postgresql'];
		const values = mergeAttributeFormValues([attr('a', { repeatable: true })], { a: fetchedTags });
		expect(values.a).toEqual(fetchedTags);
		expect(values.a).not.toBe(fetchedTags);
	});
});

describe('validateRequiredAttributes', () => {
	it('reports a required single-valued attribute left blank', () => {
		const missing = validateRequiredAttributes([attr('a', { required: true })], { a: '  ' });
		expect(missing).toEqual(['a']);
	});

	it('reports a required repeatable attribute with no non-blank rows', () => {
		const missing = validateRequiredAttributes([attr('a', { required: true, repeatable: true })], { a: ['', '  '] });
		expect(missing).toEqual(['a']);
	});

	it('passes a required repeatable attribute with at least one non-blank row', () => {
		const missing = validateRequiredAttributes([attr('a', { required: true, repeatable: true })], { a: ['', 'x'] });
		expect(missing).toEqual([]);
	});

	it('ignores non-required attributes entirely', () => {
		const missing = validateRequiredAttributes([attr('a')], { a: '' });
		expect(missing).toEqual([]);
	});
});

describe('reconcileAttributeValues — single-valued', () => {
	it('produces no submission when the value is unchanged', () => {
		const submissions = reconcileAttributeValues([attr('a')], { a: 'x' }, { a: 'x' });
		expect(submissions).toEqual([]);
	});

	it('produces a replace submission when the value changed', () => {
		const submissions = reconcileAttributeValues([attr('a', { datatype: 'date' })], { a: '1990-01-01' }, { a: '2000-01-01' });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'date', repeatable: false, value: '2000-01-01' }]);
	});

	it('produces a clear submission (value: null) when the field is emptied', () => {
		const submissions = reconcileAttributeValues([attr('a')], { a: 'x' }, { a: '  ' });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: false, value: null }]);
	});

	it('produces a submission when a brand-new value is set from empty (create mode)', () => {
		const submissions = reconcileAttributeValues([attr('a')], {}, { a: 'x' });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: false, value: 'x' }]);
	});
});

describe('reconcileAttributeValues — repeatable', () => {
	const repeatableAttr = attr('a', { repeatable: true, datatype: 'string' });

	it('produces no submission when the row set is unchanged (order-independent)', () => {
		const submissions = reconcileAttributeValues([repeatableAttr], { a: ['x', 'y'] }, { a: ['y', 'x'] });
		expect(submissions).toEqual([]);
	});

	it('diffs added and removed rows', () => {
		const submissions = reconcileAttributeValues([repeatableAttr], { a: ['x', 'y'] }, { a: ['x', 'z'] });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: true, added: ['z'], removed: ['y'] }]);
	});

	it('treats a duplicated value as two independent rows (multiset diff)', () => {
		const submissions = reconcileAttributeValues([repeatableAttr], { a: ['x'] }, { a: ['x', 'x'] });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: true, added: ['x'], removed: [] }]);
	});

	it('drops blank in-progress rows from the diff entirely', () => {
		const submissions = reconcileAttributeValues([repeatableAttr], { a: [] }, { a: ['', 'x', ''] });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: true, added: ['x'], removed: [] }]);
	});

	it('produces no submission when a row is added then removed back to the original set', () => {
		const submissions = reconcileAttributeValues([repeatableAttr], { a: ['x'] }, { a: ['x', 'z', ''] });
		expect(submissions).toEqual([{ attributeIri: 'a', datatype: 'string', repeatable: true, added: ['z'], removed: [] }]);
	});
});

describe('reconcileAttributeValues — multiple attributes', () => {
	it('only includes submissions for attributes that actually changed', () => {
		const submissions = reconcileAttributeValues(
			[attr('a'), attr('b'), attr('c', { repeatable: true })],
			{ a: 'x', b: 'y', c: ['1'] },
			{ a: 'x', b: 'changed', c: ['1'] }
		);
		expect(submissions).toEqual([{ attributeIri: 'b', datatype: 'string', repeatable: false, value: 'changed' }]);
	});
});
