import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import QuestionsTile from './QuestionsTile.svelte';

const model = { total: 4, passing: 1, failing: 2, notRun: 1, unlinked: 3, href: '/questions' };

describe('QuestionsTile (STORY-472)', () => {
	it('shows the counts and links to Questions', () => {
		render(QuestionsTile, { props: { model } });
		expect(screen.getByRole('link', { name: /4 questions/ }).getAttribute('href')).toBe('/questions');
		expect(screen.getByTestId('questions-passing')).toHaveTextContent('Passing: 1');
		expect(screen.getByTestId('questions-failing')).toHaveTextContent('Failing: 2');
		expect(screen.getByTestId('questions-notrun')).toHaveTextContent('Not run: 1');
		expect(screen.getByTestId('questions-unlinked')).toHaveTextContent('Not linked to the model: 3');
	});

	it('tells a repository without questions what to do', () => {
		render(QuestionsTile, { props: { model: { ...model, total: 0, passing: 0, failing: 0, notRun: 0, unlinked: 0 } } });
		expect(screen.getByTestId('questions-none')).toHaveTextContent('No competency questions yet');
		expect(screen.getByRole('link', { name: 'Questions' }).getAttribute('href')).toBe('/questions');
	});
});
