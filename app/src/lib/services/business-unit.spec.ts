import { describe, expect, it } from 'vitest';
import { findBusinessUnit, resolveAuthorityInput, suggestBusinessUnits } from './business-unit';

const units = [
	{ iri: 'urn:bu:data', label: 'Data Office' },
	{ iri: 'urn:bu:fin', label: 'Finance' },
	{ iri: 'urn:bu:fin2', label: 'Finance Operations' }
];

describe('findBusinessUnit', () => {
	it('matches the whole name, ignoring case and extra spaces', () => {
		expect(findBusinessUnit(units, '  data   office ')?.iri).toBe('urn:bu:data');
		expect(findBusinessUnit(units, 'Data')).toBeUndefined();
		expect(findBusinessUnit(units, '')).toBeUndefined();
	});
});

describe('suggestBusinessUnits', () => {
	it('offers existing units whose name contains the typed text, best first', () => {
		expect(suggestBusinessUnits(units, 'fin').map((u) => u.label)).toEqual(['Finance', 'Finance Operations']);
		expect(suggestBusinessUnits(units, 'office').map((u) => u.label)).toEqual(['Data Office']);
		expect(suggestBusinessUnits(units, '')).toEqual([]);
		expect(suggestBusinessUnits(units, 'zzz')).toEqual([]);
	});
});

describe('resolveAuthorityInput', () => {
	it('links a picked unit', () => {
		expect(resolveAuthorityInput({ text: 'Finance', iri: 'urn:bu:fin', units, legacy: '' })).toEqual({ authority: 'Finance', authorityIri: 'urn:bu:fin' });
	});

	it('links a typed name that equals an existing unit instead of creating one', () => {
		expect(resolveAuthorityInput({ text: 'finance', iri: '', units, legacy: '' })).toEqual({ authority: 'Finance', authorityIri: 'urn:bu:fin' });
	});

	it('asks for a new unit when the name is new', () => {
		expect(resolveAuthorityInput({ text: ' Legal ', iri: '', units, legacy: '' })).toEqual({ authority: 'Legal', authorityCreate: true });
	});

	it('leaves an unchanged old text value alone (no migration)', () => {
		expect(resolveAuthorityInput({ text: 'Data Governance', iri: '', units, legacy: 'Data Governance' })).toEqual({ authority: 'Data Governance' });
	});

	it('writes nothing for an empty name', () => {
		expect(resolveAuthorityInput({ text: '  ', iri: '', units, legacy: 'Old' })).toEqual({ authority: '' });
	});
});
