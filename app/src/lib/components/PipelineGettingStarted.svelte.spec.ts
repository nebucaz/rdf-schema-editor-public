import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PipelineGettingStarted from './PipelineGettingStarted.svelte';

describe('PipelineGettingStarted', () => {
	it('has the new summary text and opens until a namespace is part of the pipeline', () => {
		const { unmount } = render(PipelineGettingStarted, { props: { hasPipelineNamespace: false } });
		const details = screen.getByTestId('getting-started-steps') as HTMLDetailsElement;
		expect(details.querySelector('summary')?.textContent).toBe('New to the ontology pipeline? Start here');
		expect(details.open).toBe(true);
		unmount();
		render(PipelineGettingStarted, { props: { hasPipelineNamespace: true } });
		expect((screen.getByTestId('getting-started-steps') as HTMLDetailsElement).open).toBe(false);
	});

	it('states the recommended order once and keeps no enforcement paragraph', () => {
		render(PipelineGettingStarted, { props: { hasPipelineNamespace: true } });
		const text = screen.getByTestId('getting-started').textContent ?? '';
		expect(text.match(/Recommended order/g)).toHaveLength(1);
		expect(text).toContain('vocabulary, taxonomy, thesaurus, ontology, validation, application');
		expect(text).not.toContain('never enforced');
		expect(text).not.toContain('Quick start');
	});

	it('shows the recommended order outside the expandable steps', () => {
		render(PipelineGettingStarted, { props: { hasPipelineNamespace: true } });
		const steps = screen.getByTestId('getting-started-steps');
		expect(steps.textContent).not.toContain('Recommended order');
		expect(screen.getByText(/Recommended order/)).toBeVisible();
	});
});
