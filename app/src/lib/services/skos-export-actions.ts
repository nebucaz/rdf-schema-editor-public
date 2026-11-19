/**
 * What the Vocabulary page's export dialog asks for, turned into the files to download (skos-support STORY-414).
 * Pure: the page loads the data and hands the files to the browser; nothing is written anywhere.
 */
import { serializeSkosCsv } from './skos-export-csv';
import { serializeSkosTurtle, type SkosVocabulary } from './skos-export';
import { SKOS_SHAPES_TURTLE } from './skos-shapes';

export interface ExportSettings {
	format: 'turtle' | 'csv';
	/** `''` exports every scheme. */
	schemeIri: string;
	includeEditorialNotes: boolean;
	includeProjectPredicates: boolean;
	classExactMatch: boolean;
	/** A companion `.shapes.ttl`; Turtle only. */
	includeShapes: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
	format: 'turtle',
	schemeIri: '',
	includeEditorialNotes: false,
	includeProjectPredicates: false,
	classExactMatch: false,
	includeShapes: false
};

export interface ExportFile {
	name: string;
	mime: string;
	content: string;
}

const slug = (text: string) =>
	text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

export function buildExportFiles(vocab: SkosVocabulary, settings: ExportSettings, now: Date = new Date()): ExportFile[] {
	const scheme = vocab.schemes.find((s) => s.iri === settings.schemeIri);
	const base = `${(scheme && slug(scheme.name)) || 'vocabulary'}-${now.toISOString().slice(0, 10)}`;
	const schemeIri = settings.schemeIri || undefined;
	if (settings.format === 'csv') {
		return [{ name: `${base}.csv`, mime: 'text/csv;charset=utf-8', content: serializeSkosCsv(vocab, { schemeIri }) }];
	}
	const files: ExportFile[] = [
		{
			name: `${base}.ttl`,
			mime: 'text/turtle',
			content: serializeSkosTurtle(vocab, {
				schemeIri,
				includeEditorialNotes: settings.includeEditorialNotes,
				includeProjectPredicates: settings.includeProjectPredicates,
				classExactMatch: settings.classExactMatch
			})
		}
	];
	if (settings.includeShapes) files.push({ name: `${base}.shapes.ttl`, mime: 'text/turtle', content: SKOS_SHAPES_TURTLE });
	return files;
}
