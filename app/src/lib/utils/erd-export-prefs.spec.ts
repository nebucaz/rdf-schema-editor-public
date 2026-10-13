import { describe, expect, it } from 'vitest';
import type { MinimalStorage } from '$lib/stores/layout-store';
import { DEFAULT_ERD_EXPORT_PREFS, readErdExportPrefs, writeErdExportPrefs } from './erd-export-prefs';

function memoryStorage(initial: Record<string, string> = {}): MinimalStorage {
	const data = { ...initial };
	return {
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => void (data[k] = v)
	};
}

const throwing: MinimalStorage = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	}
};

describe('erd export prefs', () => {
	it('defaults to Crow\'s Foot with the legend on', () => {
		expect(readErdExportPrefs(memoryStorage())).toEqual(DEFAULT_ERD_EXPORT_PREFS);
		expect(DEFAULT_ERD_EXPORT_PREFS).toMatchObject({ notation: 'crows-foot', legend: true, format: 'svg' });
	});

	it('round-trips a persisted choice', () => {
		const s = memoryStorage();
		writeErdExportPrefs({ notation: 'chen', legend: false, format: 'png' }, s);
		expect(readErdExportPrefs(s)).toEqual({ notation: 'chen', legend: false, format: 'png' });
	});

	it('falls back per-field on invalid stored values and bad JSON', () => {
		expect(readErdExportPrefs(memoryStorage({ 'rdf-schema-editor:erd-export-prefs': '{"notation":"visio","legend":"yes","format":"gif"}' }))).toEqual(
			DEFAULT_ERD_EXPORT_PREFS
		);
		expect(readErdExportPrefs(memoryStorage({ 'rdf-schema-editor:erd-export-prefs': '{nope' }))).toEqual(DEFAULT_ERD_EXPORT_PREFS);
		expect(readErdExportPrefs(memoryStorage({ 'rdf-schema-editor:erd-export-prefs': '{"notation":"uml"}' }))).toEqual({
			...DEFAULT_ERD_EXPORT_PREFS,
			notation: 'uml'
		});
	});

	it('degrades silently when storage throws or is absent', () => {
		expect(readErdExportPrefs(throwing)).toEqual(DEFAULT_ERD_EXPORT_PREFS);
		expect(() => writeErdExportPrefs({ notation: 'uml', legend: true, format: 'svg' }, throwing)).not.toThrow();
		expect(readErdExportPrefs(undefined)).toEqual(DEFAULT_ERD_EXPORT_PREFS);
		expect(() => writeErdExportPrefs({ notation: 'uml', legend: true, format: 'svg' }, undefined)).not.toThrow();
	});
});
