import { describe, it, expect, beforeEach } from 'vitest';
import { workbenchActions } from './workbench-actions.svelte';

describe('workbenchActions.openQueryConsole', () => {
	beforeEach(() => {
		workbenchActions.queryConsoleOpen = false;
		workbenchActions.consoleInitialQuery = null;
	});

	it('opens the console without an initial query by default', () => {
		workbenchActions.openQueryConsole();
		expect(workbenchActions.queryConsoleOpen).toBe(true);
		expect(workbenchActions.consoleInitialQuery).toBeNull();
	});

	it('hands one initial query to the console when given text', () => {
		workbenchActions.openQueryConsole('SELECT * WHERE { ?s ?p ?o }');
		expect(workbenchActions.queryConsoleOpen).toBe(true);
		expect(workbenchActions.consoleInitialQuery?.text).toBe('SELECT * WHERE { ?s ?p ?o }');
	});

	it('hands over a fresh object each call so the same text re-loads', () => {
		workbenchActions.openQueryConsole('SELECT 1');
		const first = workbenchActions.consoleInitialQuery;
		workbenchActions.openQueryConsole('SELECT 1');
		expect(workbenchActions.consoleInitialQuery).not.toBe(first);
	});
});
