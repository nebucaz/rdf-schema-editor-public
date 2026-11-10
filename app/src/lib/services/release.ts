/**
 * Semantic versioning of the core ontology (ontology-pipeline STORY-333; book pp. 236-237): the bump a set of
 * changes calls for, the next version, and release notes composed from the change log. Pure.
 *
 * Major: a removed or renamed class, a changed domain or range, a new disjointness. Minor: an addition.
 * Patch: labels and comments, and anything not classed otherwise.
 */
import type { ChangeKind, ChangeLogItem } from './change-log';

export type Bump = 'patch' | 'minor' | 'major';

const MAJOR: readonly string[] = ['removal', 'rename', 'domain-range', 'disjointness'];
const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

const bumpOf = (kind: ChangeKind | ''): Bump => (MAJOR.includes(kind) ? 'major' : kind === 'addition' ? 'minor' : 'patch');

/** The highest bump any entry calls for, and the summaries of the entries at that level. `bump` is null when
 *  there are no entries: nothing to release. */
export function suggestBump(entries: ChangeLogItem[]): { bump: Bump | null; reasons: string[] } {
	if (entries.length === 0) return { bump: null, reasons: [] };
	const highest = entries.reduce<Bump>((top, e) => (RANK[bumpOf(e.changeKind)] > RANK[top] ? bumpOf(e.changeKind) : top), 'patch');
	return { bump: highest, reasons: entries.filter((e) => bumpOf(e.changeKind) === highest).map((e) => e.summary) };
}

export function nextVersion(current: string, bump: Bump): string {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
	const [major, minor, patch] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
	if (bump === 'major') return `${major + 1}.0.0`;
	if (bump === 'minor') return `${major}.${minor + 1}.0`;
	return `${major}.${minor}.${patch + 1}`;
}

/** `log` is newest first, as the server returns it: the changes before the first release entry met. */
export function entriesSinceLastRelease(log: ChangeLogItem[]): ChangeLogItem[] {
	const lastRelease = log.findIndex((e) => e.kind === 'release');
	return (lastRelease === -1 ? log : log.slice(0, lastRelease)).filter((e) => e.kind === 'change');
}

export function composeReleaseNotes(version: string, entries: ChangeLogItem[]): string {
	const line = (e: ChangeLogItem) => `- ${e.summary}${e.rationale.trim() ? ` (${e.rationale.trim()})` : ''}`;
	const groups: [string, ChangeLogItem[]][] = [
		['Breaking changes', entries.filter((e) => bumpOf(e.changeKind) === 'major')],
		['Additions', entries.filter((e) => bumpOf(e.changeKind) === 'minor')],
		['Fixes', entries.filter((e) => bumpOf(e.changeKind) === 'patch')]
	];
	const sections = groups.filter(([, items]) => items.length > 0).map(([title, items]) => `${title}\n${items.map(line).join('\n')}`);
	return [`Release ${version}`, ...sections].join('\n\n');
}
