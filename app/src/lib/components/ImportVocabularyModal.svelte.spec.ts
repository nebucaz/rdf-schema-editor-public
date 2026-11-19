import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ImportVocabularyModal from './ImportVocabularyModal.svelte';
import { FIXTURE_BASE, fixtureVocabulary } from '#lib/services/skos-fixture.js';
import type { ImportWrites } from '#lib/services/skos-import-apply.js';
import type { GateFinding } from '#lib/services/gates/types.js';

const c = (id: string) => `${FIXTURE_BASE}#${id}`;
const TTL = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <${FIXTURE_BASE}#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
ex:Brand a skos:Concept ; skos:prefLabel "Brand"@en ; foaf:name "ignored" .
ex:Manager a skos:Concept ; skos:prefLabel "Manager"@en ; skos:definition "A leader." .
ex:Contractor a skos:Concept ; skos:prefLabel "Freelancer"@en .
ex:Employees a skos:Concept ; skos:prefLabel "Employees"@en .
`;

const file = (name: string, text: string) => new File([text], name, { type: 'text/plain' });

function setup(over: Record<string, unknown> = {}) {
	const onApply = vi.fn(async (_w: ImportWrites) => ({ logProblem: null as string | null, findings: [] as GateFinding[] }));
	const onClose = vi.fn();
	render(ImportVocabularyModal, { props: { isOpen: true, existing: fixtureVocabulary(), onApply, onClose, ...over } });
	return { onApply, onClose };
}
async function choose(name: string, text: string) {
	await fireEvent.change(screen.getByLabelText('Vocabulary file'), { target: { files: [file(name, text)] } });
	// The file is read asynchronously; Preview is enabled once its text is in.
	await waitFor(() => expect((screen.getByRole('button', { name: 'Preview import' }) as HTMLButtonElement).disabled).toBe(false));
	await fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
}

describe('ImportVocabularyModal (STORY-418)', () => {
	it('previews a Turtle file with counts per category and writes nothing yet', async () => {
		const { onApply } = setup();
		await choose('terms.ttl', TTL);
		expect(await screen.findByRole('tab', { name: 'New (2)' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Changed (1)' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Conflicting (1)' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Similar (1)' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Skipped (1)' })).toBeTruthy();
		expect(onApply).not.toHaveBeenCalled();
	});

	it('shows skipped content as a visible banner', async () => {
		setup();
		await choose('terms.ttl', TTL);
		expect(await screen.findByText(/1 triple was not imported/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('tab', { name: 'Skipped (1)' }));
		expect(screen.getByText(/Not SKOS/)).toBeTruthy();
	});

	it('applies the default selection: new entries in, changed and conflicting entries kept as they are', async () => {
		const { onApply } = setup();
		await choose('terms.ttl', TTL);
		await fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));
		await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
		const writes = onApply.mock.calls[0][0];
		expect(writes.source).toBe('terms.ttl');
		expect(writes.concepts.map((w) => w.iri).sort()).toEqual([c('Brand'), c('Employees')].sort());
	});

	it('takes the imported version when the user chooses it, and skips an unticked new entry', async () => {
		const { onApply } = setup();
		await choose('terms.ttl', TTL);
		await fireEvent.click(await screen.findByLabelText('Import Brand'));
		await fireEvent.click(screen.getByRole('tab', { name: 'Changed (1)' }));
		await fireEvent.change(screen.getByLabelText('Decision for Manager'), { target: { value: 'take' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
		await waitFor(() => expect(onApply).toHaveBeenCalled());
		const writes = onApply.mock.calls[0][0];
		expect(writes.concepts.map((w) => [w.iri, w.mode]).sort()).toEqual([[c('Employees'), 'insert'], [c('Manager'), 'update']].sort());
	});

	it('marks a similar concept as the same as an existing one', async () => {
		const { onApply } = setup();
		await choose('terms.ttl', TTL);
		await fireEvent.click(await screen.findByRole('tab', { name: 'Similar (1)' }));
		await fireEvent.change(screen.getByLabelText('Same as for Employees'), { target: { value: c('Employee') } });
		await fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
		await waitFor(() => expect(onApply).toHaveBeenCalled());
		const writes = onApply.mock.calls[0][0];
		expect(writes.concepts.find((w) => w.iri === c('Employee'))).toMatchObject({ mode: 'update' });
		expect(writes.concepts.some((w) => w.iri === c('Employees'))).toBe(false);
	});

	it('shows the result and the gate findings with Open links after Apply', async () => {
		const findings = [{ gateId: 'concept-without-definition', stage: 'vocabulary', severity: 'warning', elementIri: c('Brand'), message: 'Brand has no definition' }];
		setup({ onApply: vi.fn(async () => ({ logProblem: 'Saved, but the change log entry failed: down', findings })) });
		await choose('terms.ttl', TTL);
		await fireEvent.click(await screen.findByRole('button', { name: 'Apply import' }));
		expect(await screen.findByText(/Imported "terms.ttl"/)).toBeTruthy();
		expect(screen.getByText('Brand has no definition')).toBeTruthy();
		expect(screen.getByText(/change log entry failed/)).toBeTruthy();
		const open = screen.getByRole('link', { name: 'Open' }) as HTMLAnchorElement;
		expect(open.getAttribute('href')).toContain(`/vocabulary?concept=${encodeURIComponent(c('Brand'))}`);
	});

	it('shows a parse error and stays on the file step', async () => {
		const { onApply } = setup();
		await choose('broken.ttl', 'this is not turtle');
		expect(await screen.findByText(/Not valid Turtle/)).toBeTruthy();
		expect(screen.queryByRole('tab', { name: /New/ })).toBeNull();
		expect(onApply).not.toHaveBeenCalled();
	});

	it('reads a CSV file and offers a mapping for columns it does not know', async () => {
		setup({ existing: { schemes: [], concepts: [], collections: [] } });
		await fireEvent.change(screen.getByLabelText('Vocabulary file'), { target: { files: [file('terms.csv', 'Begriff,Erklaerung\r\nTerm,Meaning\r\n')] } });
		expect(await screen.findByLabelText('Column Begriff')).toBeTruthy();
		await fireEvent.change(screen.getByLabelText('Column Begriff'), { target: { value: 'prefLabel@de' } });
		await fireEvent.change(screen.getByLabelText('Column Erklaerung'), { target: { value: 'definition' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
		expect(await screen.findByRole('tab', { name: 'New (1)' })).toBeTruthy();
	});
});

describe('import stays out of the review pages (STORY-418)', () => {
	it('no review page references the import wizard', () => {
		const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
		for (const rel of ['../../routes/review/+page.svelte', '../../routes/review/concept/+page.svelte', '../../routes/review/pipeline/+page.svelte', '../../routes/review/questions/+page.svelte']) {
			expect(read(rel), rel).not.toMatch(/ImportVocabularyModal|skos-import/);
		}
	});

	describe('Where it lands', () => {
		const SAMPLE = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <http://sample.example/demo#> .
ex:S a skos:ConceptScheme ; skos:prefLabel "Sample"@en .
ex:One a skos:Concept ; skos:prefLabel "One"@en ; skos:inScheme ex:S .
ex:Two a skos:Concept ; skos:prefLabel "Two"@en ; skos:inScheme ex:S ; skos:broader ex:One .
`;
		const open = async () => {
			await fireEvent.change(screen.getByLabelText('Vocabulary file'), { target: { files: [file('demo.ttl', SAMPLE)] } });
			await screen.findByText('Where it lands');
		};
		const apply = async () => {
			await fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
			await fireEvent.click(await screen.findByRole('button', { name: /Apply import/ }));
		};

		it('offers the file\'s IRI start and writes the concepts under the own IRIs', async () => {
			const { onApply } = setup({ coreBaseIri: 'https://my.example/core' });
			await open();
			await fireEvent.click(screen.getByLabelText('Use my own IRIs instead of the file\'s'));
			expect((screen.getByLabelText('IRI start in the file') as HTMLInputElement).value).toBe('http://sample.example/demo#');
			expect((screen.getByLabelText('Replace it with') as HTMLInputElement).value).toBe('https://my.example/core#');
			await apply();
			await waitFor(() => expect(onApply).toHaveBeenCalled());
			const w = onApply.mock.calls[0][0];
			expect(w.concepts.map((x) => x.iri).sort()).toEqual(['https://my.example/core#One', 'https://my.example/core#Two']);
			expect(w.schemes.map((x) => x.iri)).toEqual(['https://my.example/core#S']);
		});

		it('puts every concept into a new scheme with the given name and does not write the file\'s scheme', async () => {
			const { onApply } = setup({ coreBaseIri: 'https://my.example/core' });
			await open();
			await fireEvent.change(screen.getByLabelText('Scheme for every concept'), { target: { value: '__new__' } });
			await fireEvent.input(screen.getByLabelText('New scheme name'), { target: { value: 'My scheme' } });
			await apply();
			await waitFor(() => expect(onApply).toHaveBeenCalled());
			const w = onApply.mock.calls[0][0];
			expect(w.schemes).toHaveLength(1);
			expect(w.schemes[0].iri).not.toContain('sample.example');
			expect(new Set(w.concepts.map((x) => x.draft.schemeIri))).toEqual(new Set([w.schemes[0].iri]));
		});

		it('refuses a half-filled choice with a message, before any preview', async () => {
			setup();
			await open();
			await fireEvent.change(screen.getByLabelText('Scheme for every concept'), { target: { value: '__new__' } });
			await fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
			expect(await screen.findByRole('alert')).toHaveTextContent('Give the new scheme a name');
		});
	});
});
