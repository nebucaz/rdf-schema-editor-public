import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ChangeLogView from './ChangeLogView.svelte';
import type { ChangeLogItem } from '#lib/services/change-log.js';

const entry = (over: Partial<ChangeLogItem> = {}): ChangeLogItem => ({
	iri: 'urn:e:1', kind: 'change', summary: 'Added concept "Bank"', rationale: 'CQ-3 needs it', term: 'urn:c:Bank',
	question: 'urn:q:3', changeKind: 'addition', version: '1.0.0', changedBy: 'alice', changedAt: '2026-03-04T05:06:07.089Z', ...over
});

describe('ChangeLogView (STORY-331)', () => {
	it('lists who, when, what and why', () => {
		render(ChangeLogView, { props: { entries: [entry()], onFilter: vi.fn(async () => {}) } });
		expect(screen.getByText('Added concept "Bank"')).toBeTruthy();
		expect(screen.getByText('alice')).toBeTruthy();
		expect(screen.getByText('CQ-3 needs it')).toBeTruthy();
		expect(screen.getByText('1.0.0')).toBeTruthy();
	});

	it('says so when the log is empty', () => {
		render(ChangeLogView, { props: { entries: [], onFilter: vi.fn(async () => {}) } });
		expect(screen.getByText(/no entries/i)).toBeTruthy();
	});

	it('filters by term, question and version, leaving empty fields out', async () => {
		const onFilter = vi.fn(async () => {});
		render(ChangeLogView, { props: { entries: [entry()], onFilter } });
		await fireEvent.input(screen.getByLabelText('Term (IRI)'), { target: { value: 'urn:c:Bank' } });
		await fireEvent.input(screen.getByLabelText('Version'), { target: { value: '1.0.0' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
		await waitFor(() => expect(onFilter).toHaveBeenCalledWith({ term: 'urn:c:Bank', version: '1.0.0' }));
		await fireEvent.input(screen.getByLabelText('Question (IRI)'), { target: { value: 'urn:q:3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
		await waitFor(() => expect(onFilter).toHaveBeenLastCalledWith({ term: 'urn:c:Bank', question: 'urn:q:3', version: '1.0.0' }));
	});
});
