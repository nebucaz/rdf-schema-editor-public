import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import CompetencyQuestionForm from './CompetencyQuestionForm.svelte';
import type { CompetencyQuestion } from '#lib/services/competency-question.js';

const elements = [
	{ iri: 'http://e/Application', label: 'Application' },
	{ iri: 'http://e/holds', label: 'holds' }
];
const savedQueries = [{ iri: 'http://e/SavedQ', label: 'Saved Q' }];

function setup(initial?: CompetencyQuestion) {
	const onSave = vi.fn(async () => {});
	const onCancel = vi.fn();
	render(CompetencyQuestionForm, { props: { initial, elements, savedQueries, onSave, onCancel } });
	return { onSave, onCancel };
}

const save = () => screen.getByRole('button', { name: 'Save' });
const type = (label: string, value: string) =>
	fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('CompetencyQuestionForm', () => {
	it('shows the validation messages and does not save an incomplete question', async () => {
		const { onSave } = setup();
		await fireEvent.click(save());
		expect(screen.getByText('The question must not be empty.')).toBeTruthy();
		expect(screen.getByText('Enter the SPARQL query or choose a saved query.')).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('rejects an ASK query for a row expectation and a SELECT for a true/false expectation', async () => {
		const { onSave } = setup();
		await type('Question', 'Which apps hold PII?');
		await type('SPARQL query', 'ASK { ?s ?p ?o }');
		await fireEvent.click(save());
		expect(screen.getByText('A row expectation needs a SELECT query.')).toBeTruthy();

		await fireEvent.change(screen.getByLabelText('Expected result'), { target: { value: 'ask-true' } });
		await fireEvent.click(save());
		expect(onSave).toHaveBeenCalledTimes(1);

		await type('SPARQL query', 'SELECT ?a WHERE { ?a ?p ?o }');
		await fireEvent.click(save());
		expect(screen.getByText('A true/false expectation needs an ASK query.')).toBeTruthy();
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it('requires a whole minimum row count of at least 1', async () => {
		setup();
		await type('Question', 'q');
		await type('SPARQL query', 'SELECT ?a WHERE { ?a ?p ?o }');
		await type('Minimum rows', '0');
		await fireEvent.click(save());
		expect(screen.getByText('The minimum row count must be a whole number of at least 1.')).toBeTruthy();
	});

	it('saves a complete draft with linked elements, a saved query and owner', async () => {
		const { onSave } = setup();
		await type('Question', '  Which apps hold PII?  ');
		await fireEvent.change(screen.getByLabelText('Query source'), { target: { value: 'saved' } });
		await fireEvent.change(screen.getByLabelText('Saved query'), { target: { value: 'http://e/SavedQ' } });
		await fireEvent.click(screen.getByLabelText('Application'));
		await type('Owner', 'Ada');
		await type('Last reviewed', '2026-11-01');
		await fireEvent.click(save());

		expect(onSave).toHaveBeenCalledWith({
			question: 'Which apps hold PII?',
			expected: { kind: 'minRows', count: 1 },
			query: { kind: 'saved', iri: 'http://e/SavedQ' },
			linkedElements: ['http://e/Application'],
			owner: 'Ada',
			lastReviewed: '2026-11-01'
		});
	});

	it('starts from the question being edited', () => {
		setup({
			iri: 'http://e/Q',
			question: 'Existing?',
			expected: { kind: 'ask', value: false },
			query: { kind: 'sparql', text: 'ASK { ?s ?p ?o }' },
			linkedElements: ['http://e/holds'],
			owner: 'Bo',
			lastReviewed: ''
		});
		expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe('Existing?');
		expect((screen.getByLabelText('Expected result') as HTMLSelectElement).value).toBe('ask-false');
		expect((screen.getByLabelText('holds') as HTMLInputElement).checked).toBe(true);
	});

	it('shows a save error and keeps the form', async () => {
		const onSave = vi.fn(async () => {
			throw new Error('already exists');
		});
		render(CompetencyQuestionForm, {
			props: { elements, savedQueries, onSave, onCancel: vi.fn() }
		});
		await type('Question', 'q');
		await type('SPARQL query', 'SELECT ?a WHERE { ?a ?p ?o }');
		await fireEvent.click(save());
		expect((await screen.findByRole('alert')).textContent).toContain('already exists');
	});
});
