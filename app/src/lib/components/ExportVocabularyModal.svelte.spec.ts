import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ExportVocabularyModal from './ExportVocabularyModal.svelte';
import { fixtureSchemes, SCHEME } from '#lib/services/skos-fixture.js';

function setup() {
	const onExport = vi.fn();
	const onClose = vi.fn();
	render(ExportVocabularyModal, { props: { isOpen: true, schemes: fixtureSchemes, onExport, onClose } });
	return { onExport, onClose };
}

describe('ExportVocabularyModal (STORY-414)', () => {
	it('exports the whole vocabulary as Turtle by default with the plain options off', async () => {
		const { onExport } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Export' }));
		expect(onExport).toHaveBeenCalledWith({
			format: 'turtle', schemeIri: '', includeEditorialNotes: false, includeProjectPredicates: false, classExactMatch: false, includeShapes: false
		});
	});

	it('exports the chosen scheme with the chosen options', async () => {
		const { onExport } = setup();
		await fireEvent.change(screen.getByLabelText('Scope'), { target: { value: SCHEME } });
		await fireEvent.click(screen.getByLabelText('Include editorial notes'));
		await fireEvent.click(screen.getByLabelText('Include project predicates'));
		await fireEvent.click(screen.getByLabelText('Add skos:exactMatch from classes to concepts'));
		await fireEvent.click(screen.getByLabelText('Include SHACL shapes'));
		await fireEvent.click(screen.getByRole('button', { name: 'Export' }));
		expect(onExport).toHaveBeenCalledWith({
			format: 'turtle', schemeIri: SCHEME, includeEditorialNotes: true, includeProjectPredicates: true, classExactMatch: true, includeShapes: true
		});
	});

	it('disables the Turtle-only options for CSV, and exports them off', async () => {
		const { onExport } = setup();
		await fireEvent.click(screen.getByLabelText('Include editorial notes'));
		await fireEvent.click(screen.getByLabelText('CSV'));
		for (const label of ['Include editorial notes', 'Include project predicates', 'Add skos:exactMatch from classes to concepts', 'Include SHACL shapes']) {
			expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
		}
		await fireEvent.click(screen.getByRole('button', { name: 'Export' }));
		expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv', includeEditorialNotes: false, includeShapes: false }));
	});
});

describe('export stays read-only (STORY-414)', () => {
	const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

	it('the modal and the export builders make no write call and the review pages offer no export', () => {
		for (const file of ['./ExportVocabularyModal.svelte', '../services/skos-export-actions.ts', '../services/skos-export.ts', '../services/skos-export-csv.ts']) {
			const source = read(file);
			expect(source, file).not.toMatch(/sparqlConnector|executeUpdate|insertData|fetch\(|recordChange|logChange/);
		}
		for (const file of ['../../routes/review/+page.svelte', '../../routes/review/concept/+page.svelte', '../../routes/review/pipeline/+page.svelte', '../../routes/review/questions/+page.svelte']) {
			expect(read(file), file).not.toMatch(/ExportVocabularyModal|skos-export/);
		}
	});
});
