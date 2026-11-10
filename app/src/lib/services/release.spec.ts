import { describe, expect, it } from 'vitest';
import { composeReleaseNotes, entriesSinceLastRelease, nextVersion, suggestBump } from './release';
import type { ChangeKind, ChangeLogItem } from './change-log';

const entry = (changeKind: ChangeKind | '', over: Partial<ChangeLogItem> = {}): ChangeLogItem => ({
	iri: `urn:e:${Math.random()}`, kind: 'change', summary: `did ${changeKind}`, rationale: '', term: '', question: '',
	changeKind, version: '', changedBy: 'alice', changedAt: '2026-01-01T00:00:00Z', ...over
});

describe('suggestBump (STORY-333)', () => {
	it('is patch for labels and comments', () => {
		expect(suggestBump([entry('label'), entry('comment')]).bump).toBe('patch');
	});

	it('is minor for additions', () => {
		expect(suggestBump([entry('label'), entry('addition')]).bump).toBe('minor');
	});

	it.each(['removal', 'rename', 'domain-range', 'disjointness'] as const)('is major for %s', (kind) => {
		expect(suggestBump([entry('addition'), entry(kind)]).bump).toBe('major');
	});

	it('treats an entry without a kind as a patch', () => {
		expect(suggestBump([entry('')]).bump).toBe('patch');
	});

	it('names the entries that decided it', () => {
		const result = suggestBump([entry('label'), entry('rename', { summary: 'Renamed class "A" to "B"' })]);
		expect(result.reasons).toEqual(['Renamed class "A" to "B"']);
	});

	it('has nothing to suggest without entries', () => {
		expect(suggestBump([]).bump).toBeNull();
	});
});

describe('nextVersion', () => {
	it('bumps one part and resets the lower ones', () => {
		expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4');
		expect(nextVersion('1.2.3', 'minor')).toBe('1.3.0');
		expect(nextVersion('1.2.3', 'major')).toBe('2.0.0');
	});

	it('starts from 0.0.0 when no version is set or it is not a plain version', () => {
		expect(nextVersion('', 'major')).toBe('1.0.0');
		expect(nextVersion('', 'minor')).toBe('0.1.0');
		expect(nextVersion('v-next', 'patch')).toBe('0.0.1');
	});
});

describe('entriesSinceLastRelease', () => {
	it('takes the changes newer than the latest release, newest first', () => {
		const log = [
			entry('addition', { iri: 'c3' }),
			entry('label', { iri: 'c2' }),
			entry('', { iri: 'r1', kind: 'release', version: '1.0.0' }),
			entry('removal', { iri: 'c1' })
		];
		expect(entriesSinceLastRelease(log).map((e) => e.iri)).toEqual(['c3', 'c2']);
	});

	it('takes everything when there was no release yet', () => {
		expect(entriesSinceLastRelease([entry('label'), entry('addition')])).toHaveLength(2);
	});
});

describe('composeReleaseNotes', () => {
	it('groups the entries by how breaking they are', () => {
		const notes = composeReleaseNotes('2.0.0', [
			entry('rename', { summary: 'Renamed class "A" to "B"', rationale: 'CQ-1' }),
			entry('addition', { summary: 'Added class "C"' }),
			entry('label', { summary: 'Edited concept "D"' })
		]);
		expect(notes).toContain('Release 2.0.0');
		expect(notes.indexOf('Breaking')).toBeLessThan(notes.indexOf('Additions'));
		expect(notes.indexOf('Additions')).toBeLessThan(notes.indexOf('Fixes'));
		expect(notes).toContain('- Renamed class "A" to "B" (CQ-1)');
		expect(notes).toContain('- Added class "C"');
	});

	it('leaves out empty groups', () => {
		expect(composeReleaseNotes('1.0.1', [entry('label', { summary: 's' })])).not.toContain('Breaking');
	});
});
