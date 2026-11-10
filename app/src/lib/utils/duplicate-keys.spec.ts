import { afterEach, describe, expect, it, vi } from 'vitest';
import { duplicateKeys, warnDuplicateKeys } from './duplicate-keys';

describe('duplicateKeys', () => {
	it('returns each repeated key once', () => {
		expect(duplicateKeys(['a', 'b', 'a', 'a', 'c', 'b'], (x) => x)).toEqual(['a', 'b']);
	});

	it('returns nothing for unique keys', () => {
		expect(duplicateKeys([{ i: 1 }, { i: 2 }], (x) => String(x.i))).toEqual([]);
	});
});

describe('warnDuplicateKeys', () => {
	afterEach(() => vi.restoreAllMocks());

	it('warns with the list name and the keys when keys repeat', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		warnDuplicateKeys('assertions', ['x', 'y', 'x'], (k) => k);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain('assertions');
		expect(String(warn.mock.calls[0][0])).toContain('x');
	});

	it('is silent when keys are unique', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		warnDuplicateKeys('assertions', ['x', 'y'], (k) => k);
		expect(warn).not.toHaveBeenCalled();
	});
});
