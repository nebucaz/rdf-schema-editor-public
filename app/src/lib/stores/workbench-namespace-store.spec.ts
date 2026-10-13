import { describe, it, expect } from 'vitest';
import { WorkbenchNamespaceStore } from './workbench-namespace-store.svelte';
import { validationReportFilterStore } from './validation-report-filter-store.svelte';
import { workbenchActions } from './workbench-actions.svelte';

const ns = (baseIri: string, defaultHidden = false) => ({ baseIri, defaultHidden, listedInFilter: true });

describe('WorkbenchNamespaceStore', () => {
	it('has no selection until initialised', () => {
		expect(new WorkbenchNamespaceStore().selected).toBeNull();
	});

	it('initialises to the default selection once and then keeps the user’s choice', () => {
		const store = new WorkbenchNamespaceStore();
		store.ensureInitialised([ns('http://a'), ns('http://rse', true)]);
		expect(store.selected).toEqual(['http://a']);
		store.toggle('http://rse');
		store.ensureInitialised([ns('http://a'), ns('http://rse', true)]);
		expect(store.selected).toEqual(['http://a', 'http://rse']);
	});

	it('toggle removes a selected namespace and adds an unselected one', () => {
		const store = new WorkbenchNamespaceStore();
		store.ensureInitialised([ns('http://a'), ns('http://b')]);
		store.toggle('http://a');
		expect(store.selected).toEqual(['http://b']);
		store.toggle('http://a');
		expect(store.selected).toEqual(['http://b', 'http://a']);
	});

	it('setSelection replaces the selection (a loaded saved query uses its stored list)', () => {
		const store = new WorkbenchNamespaceStore();
		store.ensureInitialised([ns('http://a'), ns('http://b')]);
		store.setSelection(['http://b']);
		expect(store.selected).toEqual(['http://b']);
	});

	it('resetToDefault restores the default selection (a new query)', () => {
		const store = new WorkbenchNamespaceStore();
		const all = [ns('http://a'), ns('http://rse', true)];
		store.ensureInitialised(all);
		store.setSelection(['http://rse']);
		store.resetToDefault(all);
		expect(store.selected).toEqual(['http://a']);
	});

	it('is independent of the canvas and validation visibility state', () => {
		const store = new WorkbenchNamespaceStore();
		store.ensureInitialised([ns('http://a'), ns('http://b')]);
		const canvasBefore = new Set(workbenchActions.hiddenNamespaces);
		const validationBefore = new Set(validationReportFilterStore.hiddenNamespaces);

		store.toggle('http://a');
		expect(workbenchActions.hiddenNamespaces).toEqual(canvasBefore);
		expect(validationReportFilterStore.hiddenNamespaces).toEqual(validationBefore);

		workbenchActions.hiddenNamespaces = new Set(['http://b']);
		expect(store.selected).toEqual(['http://b']);
		workbenchActions.hiddenNamespaces = canvasBefore;
	});
});
