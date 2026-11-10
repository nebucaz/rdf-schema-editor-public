import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import ChangeRequestList from './ChangeRequestList.svelte';
import type { ChangeRequest } from '#lib/services/change-request.js';
import type { CompetencyQuestion } from '#lib/services/competency-question.js';

const question: CompetencyQuestion = {
	iri: 'urn:q:3', question: 'Which apps hold PII?', expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'x' }, linkedElements: [], owner: '', lastReviewed: ''
};
const request = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
	iri: 'urn:cr:1', title: 'Add Bank', requestor: 'alice', proposedTerm: 'Bank', proposedDefinition: 'A financial institution.',
	proposedRelations: '', rationale: 'Needed', questionIri: 'urn:q:3', changeKind: 'addition', status: 'open',
	outcomeRationale: '', decidedBy: '', decidedAt: '', createdAt: '2026-01-01', baseline: { questions: {}, findings: [] }, impact: null, ...over
});

function setup(requests: ChangeRequest[]) {
	const handlers = { onStartReview: vi.fn(async () => {}), onAssess: vi.fn(async () => {}), onDecide: vi.fn(async () => {}) };
	render(ChangeRequestList, { props: { requests, questions: [question], ...handlers } });
	return handlers;
}

describe('ChangeRequestList (STORY-332)', () => {
	it('shows the request with its status and its competency question', () => {
		setup([request()]);
		expect(screen.getByText('Add Bank')).toBeTruthy();
		expect(screen.getByText('Open')).toBeTruthy();
		expect(screen.getByText('Which apps hold PII?')).toBeTruthy();
	});

	it('flags a request without a question and offers only return and scope change', () => {
		setup([request({ questionIri: '' })]);
		expect(screen.getByText(/no competency question/i)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Return' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Scope change' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
	});

	it('starts a review', async () => {
		const { onStartReview } = setup([request()]);
		await fireEvent.click(screen.getByRole('button', { name: 'Start review' }));
		await waitFor(() => expect(onStartReview).toHaveBeenCalledWith('urn:cr:1'));
	});

	it('does not decide without a rationale', async () => {
		const { onDecide } = setup([request({ status: 'in-review' })]);
		await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
		expect(screen.getByRole('alert').textContent).toMatch(/rationale/i);
		expect(onDecide).not.toHaveBeenCalled();
	});

	it('approves and rejects with a rationale', async () => {
		const { onDecide } = setup([request({ status: 'in-review' })]);
		await fireEvent.input(screen.getByLabelText('Rationale for the outcome'), { target: { value: 'fits CQ-3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
		await waitFor(() => expect(onDecide).toHaveBeenCalledWith('urn:cr:1', 'approved', 'fits CQ-3'));
	});

	it('offers no outcome once decided and shows the rationale', () => {
		setup([request({ status: 'rejected', outcomeRationale: 'out of scope', decidedBy: 'steward' })]);
		expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
		expect(screen.getByText(/out of scope/)).toBeTruthy();
	});

	it('runs the impact assessment and lists what changed', async () => {
		const impact = {
			questions: [{ questionIri: 'urn:q:3', before: 'pass' as const, after: 'fail' as const }],
			newFindings: [{ gateId: 'g', elementIri: 'urn:x', message: 'New gap' }],
			resolvedFindings: []
		};
		const { onAssess } = setup([request({ status: 'in-review', impact })]);
		await fireEvent.click(screen.getByRole('button', { name: 'Assess impact' }));
		await waitFor(() => expect(onAssess).toHaveBeenCalledWith('urn:cr:1'));
		const panel = screen.getByTestId('impact');
		expect(within(panel).getByText(/Which apps hold PII\?/)).toBeTruthy();
		expect(panel.textContent).toContain('pass → fail');
		expect(within(panel).getByText('New gap')).toBeTruthy();
	});
});
