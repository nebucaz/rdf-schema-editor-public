/**
 * SKOS CSV export in the book's spreadsheet shape (skos-support STORY-412, Table 10 p. 123). Pure; reuses the
 * workbench's CSV writer (`utils/csv.ts`: BOM, CRLF, RFC 4180 quoting, formula neutralising).
 * Columns: `scheme`, `iri`, `notation`, then `prefLabel@<lang>` per language, `definition@<lang>` per language in use
 * (a plain `definition` for untagged text), `altLabel@<lang>`, `hiddenLabel@<lang>`, `broader`, `related`.
 * The import (STORY-416) reads exactly this format back.
 */
import { toCsv } from '#lib/utils/csv.js';
import { conceptTitle, type Concept, type LangText } from './skos-concept';
import { formatRef, joinValues } from './skos-csv-format';
import type { SkosVocabulary } from './skos-export';

export interface SkosCsvOptions {
	/** One scheme; every concept when absent. */
	schemeIri?: string;
}

const langsOf = (concepts: Concept[], pick: (c: Concept) => LangText[]) =>
	[...new Set(concepts.flatMap((c) => pick(c).map((l) => l.lang)))].sort();

/** Languages of the non-empty texts only, so an empty definition adds no column. */
const textLangsOf = (concepts: Concept[], pick: (c: Concept) => LangText[]) =>
	langsOf(concepts, (c) => pick(c).filter((l) => l.text.trim()));

export function serializeSkosCsv(vocab: SkosVocabulary, options: SkosCsvOptions = {}): string {
	const concepts = vocab.concepts.filter((c) => !options.schemeIri || c.schemeIri === options.schemeIri);
	const schemeName = new Map(vocab.schemes.map((s) => [s.iri, s.name]));
	const byIri = new Map(vocab.concepts.map((c) => [c.iri, c]));
	const prefLangs = langsOf(concepts, (c) => c.prefLabels);
	if (!prefLangs.length) prefLangs.push('en');
	const definitionLangs = textLangsOf(concepts, (c) => c.definitions);
	if (!definitionLangs.length) definitionLangs.push('');
	const altLangs = langsOf(concepts, (c) => c.altLabels);
	const hiddenLangs = langsOf(concepts, (c) => c.hiddenLabels);
	const tag = (name: string, lang: string) => (lang ? `${name}@${lang}` : name);
	const columns = [
		'scheme', 'iri', 'notation',
		...prefLangs.map((l) => tag('prefLabel', l)),
		...definitionLangs.map((l) => tag('definition', l)),
		...(altLangs.length ? altLangs : ['en']).map((l) => tag('altLabel', l)),
		...(hiddenLangs.length ? hiddenLangs : ['en']).map((l) => tag('hiddenLabel', l)),
		'broader', 'related'
	];
	const labelsIn = (labels: LangText[], lang: string) => joinValues(labels.filter((l) => l.lang === lang && l.text.trim()).map((l) => l.text));
	const ref = (iri: string) => {
		const target = byIri.get(iri);
		return target ? formatRef(conceptTitle(target), iri) : formatRef('', iri).trim();
	};
	const rows = concepts.map((c) => {
		const related = [...new Set([...(c.related ?? []), ...vocab.concepts.filter((x) => x.related?.includes(c.iri)).map((x) => x.iri)])].sort();
		return [
			schemeName.get(c.schemeIri) ?? '',
			c.iri,
			joinValues(c.notation ?? []),
			...prefLangs.map((l) => labelsIn(c.prefLabels, l)),
			...definitionLangs.map((l) => c.definitions.find((d) => d.lang === l && d.text.trim())?.text.trim() ?? ''),
			...(altLangs.length ? altLangs : ['en']).map((l) => labelsIn(c.altLabels, l)),
			...(hiddenLangs.length ? hiddenLangs : ['en']).map((l) => labelsIn(c.hiddenLabels, l)),
			joinValues((c.broader ?? []).map(ref)),
			joinValues(related.map(ref))
		];
	});
	return toCsv(columns, rows);
}
