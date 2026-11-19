import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import ValidationAbout from './ValidationAbout.svelte';

afterEach(cleanup);

describe('ValidationAbout', () => {
	it('explains SHACL validation on the SHACL tab, collapsed by default', () => {
		render(ValidationAbout);
		expect(screen.getByText('What does SHACL validation check?')).toBeTruthy();
		expect(document.querySelector('details')!.open).toBe(false);
		expect(document.body.textContent).toContain('sh:sparql');
	});

	it('says validation checks the data and that model checks are a separate thing', () => {
		render(ValidationAbout);
		expect(document.body.textContent).toContain('Model checks');
		expect(document.body.textContent).toContain('the model');
		expect(document.body.textContent).not.toContain('Gate report');
		const link = screen.getByRole('link', { name: 'Model checks' });
		expect(link.getAttribute('href')).toBe('/pipeline?tab=checks');
	});
});
