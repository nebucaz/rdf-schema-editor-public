import { describe, expect, it } from 'vitest';
import { MAX_SHARE_PARAM_LENGTH } from './query-model';
import { startQueryFromClass } from './query-model-edit';
import { isShortId, newShortId, shareLinkFor, shortLinkUrl } from './short-links';

describe('newShortId', () => {
	it('makes 10 base62 characters', () => {
		for (let i = 0; i < 50; i++) expect(newShortId()).toMatch(/^[A-Za-z0-9]{10}$/);
	});
	it('maps injected bytes onto the alphabet and skips biased bytes (>= 248)', () => {
		const bytes = [255, 0, 1, 2, 61, 62, 247, 250, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
		expect(newShortId(() => Uint8Array.from(bytes)).startsWith('ABC9A9')).toBe(true);
	});
	it('differs between calls', () => {
		expect(newShortId()).not.toBe(newShortId());
	});
});

describe('isShortId', () => {
	it('accepts only 10 alphanumerics', () => {
		expect(isShortId('aZ09aZ09aZ')).toBe(true);
		for (const bad of ['', 'short', 'aZ09aZ09aZ1', 'aZ09aZ09a>', 'aZ09aZ09a ', 'aZ09aZ09a/', null, 42])
			expect(isShortId(bad)).toBe(false);
	});
});

describe('shareLinkFor', () => {
	const model = startQueryFromClass('https://x.test/o#A', ['https://x.test/o']);
	it('uses ?m= while the model fits', () => {
		const r = shareLinkFor('https://app.test', model);
		expect(r.kind).toBe('inline');
		if (r.kind === 'inline') {
			expect(r.url.startsWith('https://app.test/workbench?m=')).toBe(true);
			expect(r.url.length - 'https://app.test/workbench?m='.length).toBeLessThanOrEqual(MAX_SHARE_PARAM_LENGTH);
		}
	});
	it('asks for a short link once it does not fit', () => {
		const big = { ...model, namespaces: ['https://x.test/' + 'n'.repeat(MAX_SHARE_PARAM_LENGTH)] };
		expect(shareLinkFor('https://app.test', big)).toEqual({ kind: 'short' });
	});
	it('builds the short URL', () => {
		expect(shortLinkUrl('https://app.test', 'aZ09aZ09aZ')).toBe('https://app.test/workbench?q=aZ09aZ09aZ');
	});
});
