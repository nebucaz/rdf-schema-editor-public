import { describe, expect, it } from 'vitest';
import { wcagContrast } from '$lib/utils/contrast';
import { NOTE_PASTEL_COLORS, NOTE_PASTEL_COLORS_DARK } from '$lib/utils/color-palette';
import {
	GROUP_TINTS,
	LocalStorageGroupColorStore,
	groupKey,
	tintFor
} from './workbench-group-color-store';

function fakeStorage(initial: Record<string, string> = {}) {
	const data = { ...initial };
	return {
		data,
		getItem: (k: string) => data[k] ?? null,
		setItem: (k: string, v: string) => void (data[k] = v)
	};
}
const KEY = 'rdf-schema-editor:workbench-group-colors';
const LIGHT = NOTE_PASTEL_COLORS[0];

describe('groupKey', () => {
	it('identifies a group by hop id and class', () => {
		expect(groupKey(null, 'http://x#A')).toBe('root|http://x#A');
		expect(groupKey('h1', 'http://x#A')).toBe('h1|http://x#A');
		expect(groupKey('h1', 'http://x#A')).not.toBe(groupKey('h1', 'http://x#B'));
	});
});

describe('LocalStorageGroupColorStore', () => {
	it('sets, reads and clears a colour', () => {
		const s = new LocalStorageGroupColorStore(fakeStorage());
		expect(s.getColor('root|a')).toBeUndefined();
		s.setColor('root|a', LIGHT);
		expect(s.getColor('root|a')).toBe(LIGHT);
		s.setColor('root|a', undefined);
		expect(s.getColor('root|a')).toBeUndefined();
	});

	it('persists across instances sharing storage', () => {
		const storage = fakeStorage();
		new LocalStorageGroupColorStore(storage).setColor('h1|a', LIGHT);
		expect(new LocalStorageGroupColorStore(storage).getColor('h1|a')).toBe(LIGHT);
	});

	it('works without storage', () => {
		const s = new LocalStorageGroupColorStore(undefined);
		s.setColor('k', LIGHT);
		expect(s.getColor('k')).toBe(LIGHT);
	});

	it('ignores malformed stored JSON', () => {
		const s = new LocalStorageGroupColorStore(fakeStorage({ [KEY]: '{not json' }));
		expect(s.getColor('k')).toBeUndefined();
		s.setColor('k', LIGHT);
		expect(s.getColor('k')).toBe(LIGHT);
	});

	it('ignores stored values that are not palette colours', () => {
		const s = new LocalStorageGroupColorStore(fakeStorage({ [KEY]: JSON.stringify({ k: 'red; background:url(x)', a: 5 }) }));
		expect(s.getColor('k')).toBeUndefined();
		expect(s.getColor('a')).toBeUndefined();
	});

	it('refuses to store a colour outside the palette', () => {
		const storage = fakeStorage();
		const s = new LocalStorageGroupColorStore(storage);
		s.setColor('k', '#123456');
		expect(s.getColor('k')).toBeUndefined();
	});

	it('survives storage that throws', () => {
		const s = new LocalStorageGroupColorStore({
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('full');
			}
		});
		expect(() => s.setColor('k', LIGHT)).not.toThrow();
		expect(s.getColor('k')).toBe(LIGHT);
	});
});

describe('tintFor', () => {
	it('maps a stored light tint to its dark counterpart per theme', () => {
		expect(tintFor(LIGHT, false)).toBe(NOTE_PASTEL_COLORS[0]);
		expect(tintFor(LIGHT, true)).toBe(NOTE_PASTEL_COLORS_DARK[0]);
		expect(tintFor(undefined, true)).toBeUndefined();
	});
});

describe('palette contrast', () => {
	it('keeps header text at WCAG AA on every tint in both themes', () => {
		expect(GROUP_TINTS.length).toBeGreaterThan(0);
		for (const t of GROUP_TINTS) {
			expect(wcagContrast('#1a1a1a', t.light)).toBeGreaterThanOrEqual(4.5);
			expect(wcagContrast('#e6e6e6', t.dark)).toBeGreaterThanOrEqual(4.5);
		}
	});
});
