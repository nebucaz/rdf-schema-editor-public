import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ValidationAbout from './ValidationAbout.svelte';

afterEach(cleanup);

describe('ValidationAbout', () => {
	it('explains SHACL validation on the SHACL tab, collapsed by default', () => {
		render(ValidationAbout, { props: { tab: 'shacl' } });
		expect(screen.getByText('What does SHACL validation check?')).toBeTruthy();
		expect(document.querySelector('details')!.open).toBe(false);
		expect(document.body.textContent).toContain('sh:sparql');
	});

	it('explains the Gate report on the gates tab', () => {
		render(ValidationAbout, { props: { tab: 'gates' } });
		expect(screen.getByText('What is the Gate report?')).toBeTruthy();
		expect(document.body.textContent).toContain('ontology pipeline');
		expect(document.body.textContent).toContain('advisory');
	});
});
