import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ConceptForm from './ConceptForm.svelte';
import type { Concept } from '#lib/services/skos-concept.js';

const concept = (over: Partial<Concept> = {}): Concept => ({
	iri: 'urn:c:1',
	prefLabels: [{ text: 'Customer', lang: 'en' }],
	altLabels: [{ text: 'Client', lang: 'en' }],
	hiddenLabels: [],
	definitions: [{ text: 'A party that buys goods.', lang: '' }],
	scopeNotes: [],
	disambiguation: '',
	schemeIri: 'urn:s:1',
	topConcept: false,
	status: 'active',
	source: '',
	authority: '',
	replacedBy: '',
	deprecationReason: '',
	created: '2026-11-01',
	modified: '2026-11-01',
	deprecatedOn: '',
	...over
});

const schemes = [{ iri: 'urn:s:1', name: 'Glossary', description: '', scope: { purpose: '', decisionsSupported: '', outOfScope: '', stakeholders: '' } }];

function setup(props: Record<string, unknown> = {}) {
	const onSave = vi.fn(async () => {});
	const onCancel = vi.fn();
	const onAddAlternative = vi.fn(async () => {});
	render(ConceptForm, { props: { schemes, existing: [concept()], onSave, onCancel, onAddAlternative, ...props } });
	return { onSave, onCancel, onAddAlternative };
}

const type = (label: string, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('ConceptForm (STORY-323)', () => {
	it('suggests an existing concept while the preferred label is typed and offers "add as alternative label"', async () => {
		const { onAddAlternative } = setup({ existing: [concept()] });
		await type('Preferred label', 'Customers');
		expect(screen.getByText(/Similar concept/i)).toBeTruthy();
		expect(screen.getByText('Customer')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Add as alternative label' }));
		expect(onAddAlternative).toHaveBeenCalledWith('urn:c:1', 'Customers', 'en');
	});

	it('shows no suggestion for an unrelated label', async () => {
		setup();
		await type('Preferred label', 'Warehouse');
		expect(screen.queryByText(/Similar concept/i)).toBeNull();
	});

	it('does not suggest the concept being edited', async () => {
		setup({ initial: concept() });
		expect(screen.queryByText(/Similar concept/i)).toBeNull();
	});

	it('shows validation messages and does not save an incomplete concept', async () => {
		const { onSave } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText('A preferred label is required')).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('refuses parentheses in the preferred label and points to the disambiguation field', async () => {
		const { onSave } = setup();
		await type('Preferred label', 'Bank (finance)');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(screen.getByText(/must not contain parentheses/)).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it('prompts for a scope note when a disambiguation is entered', async () => {
		setup();
		expect(screen.queryByText(/Add a scope note/i)).toBeNull();
		await type('Disambiguation', 'finance');
		expect(screen.getByText(/Add a scope note/i)).toBeTruthy();
		await type('Scope note', 'The institution, not the river bank');
		expect(screen.queryByText(/Add a scope note/i)).toBeNull();
	});

	it('shows the genus and differentia hint next to the definition', () => {
		setup();
		expect(screen.getByText(/what kind of thing it is.*what sets it apart/i)).toBeTruthy();
	});

	it('has a Notation field, one code per line, empty lines dropped (STORY-406)', async () => {
		const { onSave } = setup({ existing: [] });
		await type('Preferred label', 'Warehouse');
		await type('Notation (one per line)', 'WH-01\n\n WH-02 ');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved.notation).toEqual(['WH-01', 'WH-02']);
	});

	it('keeps definitions in other languages and the language of the shown one when editing (STORY-480)', async () => {
		const defs = [{ text: 'A buyer.', lang: 'en' }, { text: 'Ein Käufer.', lang: 'de' }];
		const { onSave } = setup({ initial: concept({ definitions: defs }) });
		await type('Definition', 'A party that buys.');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [{ definitions: unknown }])[0];
		expect(saved.definitions).toEqual([{ text: 'A party that buys.', lang: 'en' }, { text: 'Ein Käufer.', lang: 'de' }]);
	});

	it('writes an untagged definition back untagged (STORY-480)', async () => {
		const { onSave } = setup({ initial: concept() });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [{ definitions: unknown }])[0];
		expect(saved.definitions).toEqual([{ text: 'A party that buys goods.', lang: '' }]);
	});

	it('shows the stored notation when editing (STORY-406)', () => {
		setup({ initial: concept({ notation: ['C-7'] }) });
		expect((screen.getByLabelText('Notation (one per line)') as HTMLTextAreaElement).value).toBe('C-7');
	});

	it('has Examples and Editorial notes fields, one per line (STORY-407)', async () => {
		const { onSave } = setup({ existing: [] });
		await type('Preferred label', 'Warehouse');
		await type('Examples (one per line)', 'Rotterdam hub\n\nParcel depot');
		await type('Editorial notes (internal, one per line)', 'Check with logistics');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved.example).toEqual(['Rotterdam hub', 'Parcel depot']);
		expect(saved.editorialNote).toEqual(['Check with logistics']);
	});

	it('lists the collections a concept belongs to, read-only (STORY-410)', () => {
		setup({
			initial: concept(),
			collections: [
				{ iri: 'urn:coll:A', prefLabels: [{ text: 'Regions', lang: 'en' }], ordered: false, members: ['urn:c:1'] },
				{ iri: 'urn:coll:B', prefLabels: [{ text: 'Other', lang: 'en' }], ordered: false, members: ['urn:c:9'] }
			]
		});
		expect(screen.getByText('In collections')).toBeTruthy();
		expect(screen.getByText('Regions')).toBeTruthy();
		expect(screen.queryByText('Other')).toBeNull();
	});

	it('saves a complete draft with alternative labels one per line', async () => {
		const { onSave } = setup({ existing: [] });
		await type('Preferred label', '  Invoice ');
		await type('Alternative labels (one per line)', 'Bill\nStatement ');
		await type('Definition', 'A request for payment.');
		await fireEvent.change(screen.getByLabelText('Scheme'), { target: { value: 'urn:s:1' } });
		await fireEvent.click(screen.getByLabelText('Top concept'));
		await type('Source', 'ISO 704');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

		expect(onSave).toHaveBeenCalledTimes(1);
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved).toMatchObject({
			prefLabels: [{ text: 'Invoice', lang: 'en' }],
			altLabels: [{ text: 'Bill', lang: 'en' }, { text: 'Statement', lang: 'en' }],
			definitions: [{ text: 'A request for payment.', lang: 'en' }],
			schemeIri: 'urn:s:1',
			topConcept: true,
			source: 'ISO 704',
			status: 'proposed'
		});
	});

	it('keeps the status and extra-language labels of the concept being edited', async () => {
		const initial = concept({ prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }] });
		const { onSave } = setup({ initial, existing: [initial] });
		await type('Definition', 'Changed.');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const saved = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(saved).toMatchObject({
			status: 'active',
			prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }],
			definitions: [{ text: 'Changed.', lang: 'en' }, { text: 'A party that buys goods.', lang: '' }]
		});
	});

	it('shows an error from the connector', async () => {
		const onSave = vi.fn(async () => {
			throw new Error('A concept "Invoice" already exists');
		});
		setup({ onSave, existing: [] });
		await type('Preferred label', 'Invoice');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText(/already exists/)).toBeTruthy();
	});
});

describe('ConceptForm language tabs (STORY-483)', () => {
	const bilingual = () =>
		concept({
			prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }],
			altLabels: [{ text: 'Client', lang: 'en' }, { text: 'Abnehmer', lang: 'de' }],
			hiddenLabels: [{ text: 'Custommer', lang: 'en' }],
			definitions: [{ text: 'A buyer.', lang: 'en' }, { text: 'Ein Käufer.', lang: 'de' }]
		});
	const tabNamed = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) });
	const saved = (onSave: ReturnType<typeof vi.fn>) => (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];

	it('opens one tab per language, each with its own texts', async () => {
		setup({ initial: bilingual() });
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['en', 'de']);
		expect((screen.getByLabelText('Preferred label') as HTMLInputElement).value).toBe('Customer');
		await fireEvent.click(tabNamed('de'));
		expect((screen.getByLabelText('Preferred label') as HTMLInputElement).value).toBe('Kunde');
		expect((screen.getByLabelText('Definition') as HTMLTextAreaElement).value).toBe('Ein Käufer.');
		expect((screen.getByLabelText('Alternative labels (one per line)') as HTMLTextAreaElement).value).toBe('Abnehmer');
	});

	it('editing de leaves en and every label language unchanged', async () => {
		const { onSave } = setup({ initial: bilingual() });
		await fireEvent.click(tabNamed('de'));
		await type('Definition', 'Ein Abnehmer.');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(saved(onSave)).toMatchObject({
			prefLabels: [{ text: 'Customer', lang: 'en' }, { text: 'Kunde', lang: 'de' }],
			altLabels: [{ text: 'Client', lang: 'en' }, { text: 'Abnehmer', lang: 'de' }],
			hiddenLabels: [{ text: 'Custommer', lang: 'en' }],
			definitions: [{ text: 'A buyer.', lang: 'en' }, { text: 'Ein Abnehmer.', lang: 'de' }]
		});
	});

	it('adds a language and saves its texts', async () => {
		const { onSave } = setup({ initial: concept() });
		await type('New language tag', 'FR');
		await fireEvent.click(screen.getByRole('button', { name: '+ Add language' }));
		await type('Preferred label', 'Client');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(saved(onSave).prefLabels).toEqual([{ text: 'Customer', lang: 'en' }, { text: 'Client', lang: 'fr' }]);
	});

	it('refuses an invalid and a duplicate language tag', async () => {
		setup({ initial: concept() });
		const before = screen.getAllByRole('tab').length;
		await type('New language tag', 'not a tag');
		await fireEvent.click(screen.getByRole('button', { name: '+ Add language' }));
		expect(screen.getByText(/Invalid language tag/)).toBeTruthy();
		await type('New language tag', 'EN');
		await fireEvent.click(screen.getByRole('button', { name: '+ Add language' }));
		expect(screen.getByText(/already there/)).toBeTruthy();
		expect(screen.getAllByRole('tab')).toHaveLength(before);
	});

	it('a new concept starts with an en tab', () => {
		setup();
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['en']);
	});

	it('opens untagged texts in a "No language" tab', () => {
		setup({ initial: concept({ prefLabels: [{ text: 'Customer', lang: '' }], altLabels: [], definitions: [] }) });
		expect(screen.getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['No language']);
	});

	it('removes a language with its texts after confirming, and never the last one', async () => {
		const { onSave } = setup({ initial: bilingual() });
		await fireEvent.click(tabNamed('de'));
		await fireEvent.click(screen.getByRole('button', { name: 'Remove language' }));
		expect(screen.getByRole('alert').textContent).toMatch(/every text/);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove de' }));
		expect(screen.getAllByRole('tab')).toHaveLength(1);
		expect((screen.getByRole('button', { name: 'Remove language' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const draft = saved(onSave);
		expect(draft.prefLabels).toEqual([{ text: 'Customer', lang: 'en' }]);
		expect(draft.altLabels).toEqual([{ text: 'Client', lang: 'en' }]);
		expect(draft.definitions).toEqual([{ text: 'A buyer.', lang: 'en' }]);
	});

	it('tabs are a keyboard-operable tablist', async () => {
		setup({ initial: bilingual() });
		expect(screen.getByRole('tablist')).toBeTruthy();
		await fireEvent.keyDown(tabNamed('en'), { key: 'ArrowRight' });
		expect(tabNamed('de').getAttribute('aria-selected')).toBe('true');
		await fireEvent.keyDown(tabNamed('de'), { key: 'ArrowRight' });
		expect(tabNamed('en').getAttribute('aria-selected')).toBe('true');
	});

	it('marks the tab with an error, names the language and shows that tab', async () => {
		const { onSave } = setup({ initial: bilingual() });
		await fireEvent.click(tabNamed('de'));
		await type('Preferred label', 'Kunde (B2B)');
		await fireEvent.click(tabNamed('en'));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(onSave).not.toHaveBeenCalled();
		expect(tabNamed('de').textContent).toContain('!');
		expect(tabNamed('de').getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText(/must not contain parentheses.*\(de\)/)).toBeTruthy();
	});

	it('suggests similar concepts from the active tab and adds the alternative in its language', async () => {
		const { onAddAlternative } = setup({ initial: bilingual(), existing: [concept({ iri: 'urn:c:2', prefLabels: [{ text: 'Verkauf', lang: 'de' }], altLabels: [] })] });
		await fireEvent.click(tabNamed('de'));
		await type('Preferred label', 'Verkäufe');
		await fireEvent.click(screen.getByRole('button', { name: 'Add as alternative label' }));
		expect(onAddAlternative).toHaveBeenCalledWith('urn:c:2', 'Verkäufe', 'de');
	});
});

describe('ConceptForm authority (business unit)', () => {
	const units = [{ iri: 'urn:bu:data', label: 'Data Office' }, { iri: 'urn:bu:fin', label: 'Finance' }];
	const savedDraft = (onSave: ReturnType<typeof vi.fn>) => (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];

	it('links a picked business unit', async () => {
		const { onSave } = setup({ initial: concept(), businessUnits: units });
		await type('Authority', 'fin');
		await fireEvent.click(screen.getByRole('option', { name: 'Finance' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(savedDraft(onSave)).toMatchObject({ authority: 'Finance', authorityIri: 'urn:bu:fin' });
		expect(savedDraft(onSave).authorityCreate).toBeUndefined();
	});

	it('asks to create a unit for a new name', async () => {
		const { onSave } = setup({ initial: concept(), businessUnits: units });
		await type('Authority', 'Legal');
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(savedDraft(onSave)).toMatchObject({ authority: 'Legal', authorityCreate: true });
	});

	it('keeps an unchanged old text value as text, and a linked unit as a link', async () => {
		const old = setup({ initial: concept({ authority: 'Data Governance' }), businessUnits: units });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(savedDraft(old.onSave)).toMatchObject({ authority: 'Data Governance' });
		expect(savedDraft(old.onSave).authorityIri).toBeUndefined();
		expect(savedDraft(old.onSave).authorityCreate).toBeUndefined();
	});

	it('keeps a linked unit when the concept is saved unchanged', async () => {
		const { onSave } = setup({ initial: concept({ authority: 'Finance', authorityIri: 'urn:bu:fin' }), businessUnits: units });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(savedDraft(onSave)).toMatchObject({ authority: 'Finance', authorityIri: 'urn:bu:fin' });
	});
});

describe('ConceptForm authority without the unit list', () => {
	it('keeps the link of a concept even when the list of units has not loaded', async () => {
		const { onSave } = setup({ initial: concept({ authority: 'Finance', authorityIri: 'urn:bu:fin' }), businessUnits: [] });
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		const draft = (onSave.mock.calls[0] as unknown as [Record<string, unknown>])[0];
		expect(draft).toMatchObject({ authority: 'Finance', authorityIri: 'urn:bu:fin' });
		expect(draft.authorityCreate).toBeUndefined();
	});
});
