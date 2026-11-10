import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ChangeRequestForm from './ChangeRequestForm.svelte';
import type { CompetencyQuestion } from '#lib/services/competency-question.js';

const question: CompetencyQuestion = {
	iri: 'urn:q:3', question: 'Which apps hold PII?', expected: { kind: 'minRows', count: 1 },
	query: { kind: 'sparql', text: 'SELECT * WHERE {?s ?p ?o}' }, linkedElements: [], owner: '', lastReviewed: ''
};

function setup() {
	const onSave = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(ChangeRequestForm, { props: { questions: [question], requestor: 'alice', onSave, onCancel } });
	return { onSave, onCancel };
}

describe('ChangeRequestForm (STORY-332)', () => {
	it('flags a request without a competency question and explains the consequence', () => {
		setup();
		const flag = screen.getByTestId('missing-question');
		expect(flag.textContent).toMatch(/returned or marked as a scope change/i);
	});

	it('drops the flag once a question is linked', async () => {
		setup();
		await fireEvent.change(screen.getByLabelText('Competency question'), { target: { value: 'urn:q:3' } });
		expect(screen.queryByTestId('missing-question')).toBeNull();
	});

	it('refuses an incomplete request and shows what is missing', async () => {
		const { onSave } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
		expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
		expect(onSave).not.toHaveBeenCalled();
	});

	it('submits the draft with the requestor prefilled', async () => {
		const { onSave } = setup();
		await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Add Bank' } });
		await fireEvent.input(screen.getByLabelText('Proposed term'), { target: { value: 'Bank' } });
		await fireEvent.input(screen.getByLabelText('Rationale'), { target: { value: 'Needed' } });
		await fireEvent.change(screen.getByLabelText('Competency question'), { target: { value: 'urn:q:3' } });
		await fireEvent.change(screen.getByLabelText('Kind of change'), { target: { value: 'addition' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
		await waitFor(() =>
			expect(onSave).toHaveBeenCalledWith({
				title: 'Add Bank', requestor: 'alice', proposedTerm: 'Bank', proposedDefinition: '', proposedRelations: '',
				rationale: 'Needed', questionIri: 'urn:q:3', changeKind: 'addition'
			})
		);
	});
});
