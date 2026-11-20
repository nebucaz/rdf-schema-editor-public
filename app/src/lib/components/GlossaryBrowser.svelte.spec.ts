import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import GlossaryBrowser from './GlossaryBrowser.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const c = (iri: string, label: string, over: Partial<Concept> = {}): Concept => ({
	iri,
	prefLabels: [{ text: label, lang: 'en' }],
	altLabels: [],
	hiddenLabels: [],
	definitions: [{ text: `Definition of ${label}`, lang: '' }],
	scopeNotes: [],
	disambiguation: '',
	schemeIri: 's',
	topConcept: false,
	status: 'active',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	created: '',
	modified: '',
	deprecatedOn: '',
	...over
});

const concepts = [
	c('x:staff', 'Staff', { topConcept: true }),
	c('x:nurse', 'Nurse', {
		broader: ['x:staff'],
		hiddenLabels: [{ text: 'Sister', lang: 'en' }],
		editorialNote: ['check with HR'],
		example: ['Ward nurse'],
		scopeNotes: [{ text: 'Registered only', lang: '' }],
		mappings: [{ kind: 'exactMatch', target: 'http://other.example/Nurse' }]
	}),
	c('x:old', 'Locum', { status: 'deprecated', replacedBy: 'x:nurse', deprecationReason: 'merged' })
];
const props = {
	concepts,
	collections: [{ iri: 'x:col', prefLabels: [{ text: 'Clinical', lang: 'en' }], ordered: false, members: ['x:nurse'] }],
	classes: [{ iri: 'http://e/Nurse', label: 'Nurse class', definedByConcept: 'x:nurse' }]
};

describe('GlossaryBrowser', () => {
	it('lists the same concepts in the A-Z and the tree view', async () => {
		render(GlossaryBrowser, { props });
		const az = screen.getAllByRole('button', { name: /^(Staff|Nurse|Locum)$/ }).map((b) => b.textContent);
		expect(az.sort()).toEqual(['Locum', 'Nurse', 'Staff']);
		await fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
		const tree = screen.getAllByRole('treeitem').map((b) => b.textContent?.trim());
		expect(tree.sort()).toEqual(['Locum', 'Nurse', 'Staff'].sort());
	});

	it('finds a concept by a hidden label without displaying it', async () => {
		const { container } = render(GlossaryBrowser, { props });
		await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'sister' } });
		expect(screen.queryByRole('button', { name: 'Staff' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Nurse' }));
		expect(container.textContent).not.toContain('Sister');
	});

	it('shows the detail without editorial notes, with classes, collections and mappings', async () => {
		const { container } = render(GlossaryBrowser, { props });
		await fireEvent.click(screen.getByRole('button', { name: 'Nurse' }));
		const text = container.textContent ?? '';
		expect(text).toContain('Definition of Nurse');
		expect(text).toContain('Registered only');
		expect(text).toContain('Ward nurse');
		expect(text).toContain('Clinical');
		expect(text).toContain('http://other.example/Nurse');
		expect(text).not.toContain('check with HR');
		const link = screen.getByRole('link', { name: 'Nurse class' }) as HTMLAnchorElement;
		expect(link.getAttribute('href')).toContain('focus=' + encodeURIComponent('http://e/Nurse'));
	});

	it('shows a deprecated concept struck through with its replacement', async () => {
		const { container } = render(GlossaryBrowser, { props });
		await fireEvent.click(screen.getByRole('button', { name: 'Locum' }));
		expect(container.querySelector('.deprecated')).not.toBeNull();
		expect(container.textContent).toContain('replaced by');
	});
});

describe('GlossaryBrowser page link', () => {
	it('links the selected term to its own read-only page', async () => {
		render(GlossaryBrowser, { props: { concepts } });
		expect(screen.queryByRole('link', { name: 'Page of this term to share' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Staff' }));
		const link = screen.getByRole('link', { name: 'Page of this term to share' });
		expect(link.getAttribute('href')).toContain('/review/concept?iri=x%3Astaff');
	});
});
