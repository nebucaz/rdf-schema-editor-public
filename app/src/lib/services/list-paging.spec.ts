import { describe, expect, it } from 'vitest';
import { clampPage, pageCount, pageWindow } from './list-paging';

describe('pageCount', () => {
	it('is 1 for an empty list so the pager always has a page', () => {
		expect(pageCount(0, 25)).toBe(1);
	});
	it('is 1 for fewer items than one page and for exactly one page', () => {
		expect(pageCount(1, 25)).toBe(1);
		expect(pageCount(25, 25)).toBe(1);
	});
	it('rounds up', () => {
		expect(pageCount(26, 25)).toBe(2);
		expect(pageCount(50, 25)).toBe(2);
		expect(pageCount(51, 25)).toBe(3);
	});
	it('treats a bad page size as 1', () => {
		expect(pageCount(3, 0)).toBe(3);
	});
});

describe('clampPage', () => {
	it('keeps a page in range', () => {
		expect(clampPage(2, 7)).toBe(2);
	});
	it('clamps below 1 and above the last page', () => {
		expect(clampPage(0, 7)).toBe(1);
		expect(clampPage(-3, 7)).toBe(1);
		expect(clampPage(9, 7)).toBe(7);
	});
	it('falls back to 1 for NaN', () => {
		expect(clampPage(Number.NaN, 7)).toBe(1);
	});
});

describe('pageWindow', () => {
	it('lists every page when there are few', () => {
		expect(pageWindow(1, 1)).toEqual([1]);
		expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
	});
	it('uses null for a gap, keeping first, last and the neighbours of the current page', () => {
		expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
		expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
		expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
	});
	it('does not make a gap for a single hidden page', () => {
		expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, null, 8]);
	});
});
