import { describe, it, expect } from 'vitest';
import { defaultWorkbenchNamespaces, hiddenFromSelection } from './workbench-namespace';

const ns = (baseIri: string, o: { defaultHidden?: boolean; listedInFilter?: boolean } = {}) => ({
	baseIri,
	defaultHidden: o.defaultHidden ?? false,
	listedInFilter: o.listedInFilter ?? true
});

describe('defaultWorkbenchNamespaces', () => {
	it('selects every namespace except those flagged defaultHidden', () => {
		const result = defaultWorkbenchNamespaces([
			ns('http://a'),
			ns('http://rse', { defaultHidden: true }),
			ns('http://b')
		]);
		expect(result).toEqual(['http://a', 'http://b']);
	});

	it('hard-codes nothing: a namespace is hidden because of its flag, not its IRI', () => {
		const result = defaultWorkbenchNamespaces([
			ns('http://rse'),
			ns('http://other', { defaultHidden: true })
		]);
		expect(result).toEqual(['http://rse']);
	});

	it('returns an empty list for no namespaces', () => {
		expect(defaultWorkbenchNamespaces([])).toEqual([]);
	});
});

describe('hiddenFromSelection', () => {
	it('is the listed namespaces that are not selected', () => {
		const all = [ns('http://a'), ns('http://b'), ns('http://c', { listedInFilter: false })];
		expect(hiddenFromSelection(all, ['http://a'])).toEqual(new Set(['http://b']));
	});
});
