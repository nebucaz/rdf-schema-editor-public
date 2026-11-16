import { describe, expect, it } from 'vitest';
import { buildFindingLink, buildFindingPath, isFindingId, parseFindingParam } from './finding-link';

describe('finding links (validation-issues-tracker STORY-390)', () => {
	it('accepts only the 16 character base32 finding id', () => {
		expect(isFindingId('abcdefghijklmnop')).toBe(true);
		expect(isFindingId('a2b3c4d5e6f7g2h3')).toBe(true);
		for (const bad of ['', 'short', 'ABCDEFGHIJKLMNOP', 'abcdefghijklmno1', 'abcdefghijklmnopq', 'abcdefghijklmn p', '../etc/passwd0000']) {
			expect(isFindingId(bad)).toBe(false);
		}
	});

	it('parses the finding parameter into ok, absent or malformed', () => {
		expect(parseFindingParam(new URLSearchParams('finding=abcdefghijklmnop'))).toEqual({ kind: 'ok', id: 'abcdefghijklmnop' });
		expect(parseFindingParam(new URLSearchParams(''))).toEqual({ kind: 'none' });
		expect(parseFindingParam(new URLSearchParams('finding='))).toEqual({ kind: 'none' });
		expect(parseFindingParam(new URLSearchParams('finding=<script>'))).toEqual({ kind: 'malformed' });
	});

	it('builds the in-app path and the absolute link under the base path', () => {
		expect(buildFindingPath('abcdefghijklmnop')).toMatch(/\/validation\?finding=abcdefghijklmnop$/);
		expect(buildFindingLink('https://host', 'abcdefghijklmnop')).toBe(`https://host${buildFindingPath('abcdefghijklmnop')}`);
	});

	it('refuses to build a link for a malformed id', () => {
		expect(() => buildFindingPath('a&b=c')).toThrow();
	});
});
