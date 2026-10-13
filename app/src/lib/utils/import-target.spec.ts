import { describe, it, expect } from 'vitest';
import { importTargetOptions, initialImportTarget, isTurtleFileName } from './import-target';

const ns = (baseIri: string, prefix: string) => ({ baseIri, prefix });
const RSE = 'http://example.org/rse';
const all = [ns('http://example.org/soc', 'soc'), ns(RSE, 'rse'), ns('http://example.org/core', 'core')];

describe('importTargetOptions', () => {
	it('excludes the bookkeeping namespace and sorts by prefix', () => {
		expect(importTargetOptions(all, RSE).map((n) => n.prefix)).toEqual(['core', 'soc']);
	});

	it('does not mutate its input', () => {
		const copy = [...all];
		importTargetOptions(all, RSE);
		expect(all).toEqual(copy);
	});

	it('returns an empty list when only the bookkeeping namespace exists', () => {
		expect(importTargetOptions([ns(RSE, 'rse')], RSE)).toEqual([]);
	});
});

describe('initialImportTarget', () => {
	const options = importTargetOptions(all, RSE);

	it('preselects the active namespace when it is a valid target', () => {
		expect(initialImportTarget(options, 'http://example.org/soc')).toBe('http://example.org/soc');
	});

	it('requires an explicit choice when the active namespace is unknown, excluded or null', () => {
		expect(initialImportTarget(options, RSE)).toBeNull();
		expect(initialImportTarget(options, null)).toBeNull();
	});

	it('preselects the only option', () => {
		expect(initialImportTarget([ns('http://example.org/soc', 'soc')], null)).toBe('http://example.org/soc');
	});
});

describe('isTurtleFileName', () => {
	it.each([['soc-schema.ttl', true], ['DATA.TTL', true], ['notes.txt', false], ['ttl', false], ['a.ttl.bak', false]])(
		'%s -> %s',
		(name, ok) => expect(isTurtleFileName(name)).toBe(ok)
	);
});
