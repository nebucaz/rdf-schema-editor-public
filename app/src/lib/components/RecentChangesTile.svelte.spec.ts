import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RecentChangesTile from './RecentChangesTile.svelte';
import type { ChangeLogItem } from '#lib/services/change-log.js';

const entry = (n: number, over: Partial<ChangeLogItem> = {}): ChangeLogItem => ({
	iri: `urn:e${n}`, kind: 'change', summary: `Summary ${n}`, rationale: '', term: '', question: '', changeKind: '', version: '1.0.0',
	changedBy: 'alice', changedAt: `2026-03-0${n}T10:00:00Z`, ...over
});

describe('RecentChangesTile (STORY-473)', () => {
	it('lists the entries with day, author and a link only where the page knows the object', () => {
		render(RecentChangesTile, {
			props: {
				status: 'ready',
				entries: [entry(1, { term: 'urn:known' }), entry(2, { term: 'urn:unknown' }), entry(3, { kind: 'release', version: '2.0.0', summary: 'Spring release' })],
				linkFor: (iri) => (iri === 'urn:known' ? '/vocabulary?concept=urn%3Aknown' : null)
			}
		});
		expect(screen.getAllByRole('listitem')).toHaveLength(3);
		expect(screen.getByRole('link', { name: 'Summary 1' }).getAttribute('href')).toBe('/vocabulary?concept=urn%3Aknown');
		expect(screen.queryByRole('link', { name: 'Summary 2' })).toBeNull();
		expect(screen.getByText('Summary 2')).toBeInTheDocument();
		expect(screen.getByText('2026-03-01')).toBeInTheDocument();
		expect(screen.getByText('Release 2.0.0:')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Change log' }).getAttribute('href')).toBe('/governance');
	});

	it('shows loading, an empty note and a local failure notice', () => {
		const loading = render(RecentChangesTile, { props: { status: 'loading' } });
		expect(screen.getByTestId('changes-loading')).toBeInTheDocument();
		loading.unmount();
		const empty = render(RecentChangesTile, { props: { status: 'ready', entries: [] } });
		expect(screen.getByTestId('changes-none')).toBeInTheDocument();
		empty.unmount();
		render(RecentChangesTile, { props: { status: 'error', error: 'offline' } });
		expect(screen.getByTestId('changes-error')).toHaveTextContent('The change log could not be read: offline.');
	});
});
