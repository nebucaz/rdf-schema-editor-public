/**
 * SKOS CSV import (skos-support STORY-416): reads the flat spreadsheet format written by `skos-export-csv.ts` and the book's
 * indented level layout (`L1`, `L2`, `L3`) into the same `ParsedImport` as the Turtle reader, so one plan, one preview and one
 * apply serve both. Pure. Formula guards are an export concern: nothing is neutralised here, but cells are trimmed and
 * unprintable characters are stripped and reported. Rows that cannot be read are listed with their row number.
 */
import { conceptIri, conceptSchemeIri } from '#lib/utils/iri.js';
import { isSafeSparqlIri } from '#lib/utils/sparql-safe.js';
import type { Concept, LangText } from './skos-concept';
import { parseRef, splitValues } from './skos-csv-format';
import { DEFAULT_IMPORT_LIMITS, ImportRefused, type ImportIssue, type ImportLimits, type ImportedConcept, type ImportedScheme, type ParsedImport } from './skos-import';

/** RFC 4180 reader: quotes, doubled quotes, embedded line breaks, CRLF or LF, and a leading BOM. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	let started = false;
	const src = text.replace(/^﻿/, '');
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === '"') {
				if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
			} else field += ch;
		} else if (ch === '"' && field === '') {
			quoted = true;
			started = true;
		} else if (ch === ',') {
			row.push(field); field = ''; started = true;
		} else if (ch === '\n' || ch === '\r') {
			if (ch === '\r' && src[i + 1] === '\n') i++;
			if (started || field !== '' || row.length) { row.push(field); rows.push(row); }
			row = []; field = ''; started = false;
		} else { field += ch; started = true; }
	}
	if (started || field !== '' || row.length) { row.push(field); rows.push(row); }
	return rows;
}

/** What a column means. `prefLabel`, `altLabel`, `hiddenLabel` and `definition` may carry `@lang`. */
export type CsvField = 'scheme' | 'iri' | 'notation' | 'prefLabel' | 'altLabel' | 'hiddenLabel' | 'definition' | 'broader' | 'related' | 'level1' | 'level2' | 'level3' | 'ignore';
interface Column {
	field: CsvField;
	lang: string;
}

const ALIASES: Record<string, CsvField> = {
	scheme: 'scheme', iri: 'iri', notation: 'notation', concept: 'prefLabel', label: 'prefLabel', preflabel: 'prefLabel',
	definition: 'definition', altlabel: 'altLabel', hiddenlabel: 'hiddenLabel', broader: 'broader', related: 'related',
	l1: 'level1', l2: 'level2', l3: 'level3', 'concept l1': 'level1', 'concept l2': 'level2', 'concept l3': 'level3'
};

/** `prefLabel@en` -> `{ field: 'prefLabel', lang: 'en' }`; `null` for a header the reader does not know. */
function classify(header: string, columnMap: Record<string, string>): Column | null {
	const mapped = (columnMap[header] ?? header).trim();
	if (mapped === 'ignore') return { field: 'ignore', lang: '' };
	const at = mapped.indexOf('@');
	const name = (at >= 0 ? mapped.slice(0, at) : mapped).trim().toLowerCase();
	const field = ALIASES[name];
	return field ? { field, lang: at >= 0 ? mapped.slice(at + 1).trim() : '' } : null;
}

export function readCsvHeaders(text: string, columnMap: Record<string, string> = {}): { headers: string[]; unknown: string[] } {
	const headers = (parseCsv(text)[0] ?? []).map((h) => h.trim());
	return { headers, unknown: headers.filter((h) => h && !classify(h, columnMap)) };
}

export interface CsvImportOptions {
	/** The core vocabulary namespace; concept and scheme IRIs are minted under it. */
	coreBaseIri: string;
	/** Loaded concepts, to resolve a `broader` that names an existing concept. */
	existing?: Concept[];
	/** Header text -> a field name such as `prefLabel@de` or `ignore`, for columns the reader does not know. */
	columnMap?: Record<string, string>;
	limits?: Partial<ImportLimits>;
}

// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

interface Row {
	number: number;
	scheme: string;
	iri: string;
	label: LangText[];
	notation: string[];
	definition: string;
	alt: LangText[];
	hidden: LangText[];
	broader: string[];
	related: string[];
	level: number;
	levelLabel: string;
}

export function parseSkosCsv(text: string, options: CsvImportOptions): ParsedImport {
	const cap = { ...DEFAULT_IMPORT_LIMITS, ...options.limits };
	if (text.length > cap.maxBytes) throw new ImportRefused(`The file is too large (limit ${cap.maxBytes} characters)`);
	const table = parseCsv(text);
	const errors: ImportIssue[] = [];
	const info: ImportIssue[] = [];
	const map = options.columnMap ?? {};
	const headers = (table[0] ?? []).map((h) => h.trim());
	const columns = headers.map((h) => classify(h, map));
	const hasLabelColumn = columns.some((c) => c && (c.field === 'prefLabel' || c.field === 'level1'));
	const indented = columns.some((c) => c?.field === 'level1');
	const mint = (label: string) => conceptIri(label, '', options.coreBaseIri);

	const rows: Row[] = [];
	for (let r = 1; r < table.length; r++) {
		const cells = table[r];
		const number = r + 1;
		if (cells.every((c) => !c.trim())) continue;
		if (cells.length > headers.length) {
			errors.push({ code: 'unreadable-row', row: number, message: `Row ${number}: the line has ${cells.length} cells but the header has ${headers.length}` });
			continue;
		}
		const row: Row = { number, scheme: '', iri: '', label: [], notation: [], definition: '', alt: [], hidden: [], broader: [], related: [], level: 0, levelLabel: '' };
		let stripped = false;
		cells.forEach((raw, i) => {
			const col = columns[i];
			if (!col || col.field === 'ignore') return;
			const cleaned = raw.replace(UNPRINTABLE, '');
			if (cleaned !== raw) stripped = true;
			const value = cleaned.trim();
			if (!value) return;
			const labels = (list: LangText[]) => splitValues(value).forEach((t) => list.push({ text: t, lang: col.lang }));
			switch (col.field) {
				case 'scheme': row.scheme = value; break;
				case 'iri': row.iri = value; break;
				case 'notation': row.notation.push(...splitValues(value)); break;
				case 'prefLabel': row.label.push({ text: value, lang: col.lang }); break;
				case 'definition': row.definition = value; break;
				case 'altLabel': labels(row.alt); break;
				case 'hiddenLabel': labels(row.hidden); break;
				case 'broader': row.broader.push(...splitValues(value)); break;
				case 'related': row.related.push(...splitValues(value)); break;
				case 'level1': case 'level2': case 'level3':
					row.level = Number(col.field.slice(-1)); row.levelLabel = value; row.label.push({ text: value, lang: col.lang }); break;
			}
		});
		if (stripped) info.push({ code: 'stripped-characters', row: number, message: `Row ${number}: unprintable characters were removed` });
		if (!row.label.length) {
			errors.push({ code: 'missing-label', row: number, message: `Row ${number}: the row has no preferred label` });
			continue;
		}
		rows.push(row);
	}
	if (!hasLabelColumn && rows.length === 0 && table.length > 1 && !errors.length) {
		errors.push({ code: 'missing-label', row: 2, message: 'Row 2: no column holds the preferred label; map one (prefLabel, concept or L1)' });
	}
	if (rows.length > cap.maxConcepts) throw new ImportRefused(`The file has more than ${cap.maxConcepts} concepts`);

	const schemes = new Map<string, ImportedScheme>();
	const concepts = new Map<string, ImportedConcept>();
	const iriOfRow = new Map<Row, string>();
	const unique: Row[] = [];
	for (const row of rows) {
		const iri = row.iri || mint(row.label[0].text);
		if (!isSafeSparqlIri(iri)) throw new ImportRefused(`Row ${row.number}: unsafe IRI ${iri}`);
		if (concepts.has(iri)) {
			errors.push({ code: 'duplicate-iri', row: row.number, iri, message: `Row ${row.number}: "${row.label[0].text}" mints the same IRI as an earlier row (${iri}); give one of them a qualifier or an iri column` });
			continue;
		}
		const schemeIri = row.scheme ? conceptSchemeIri(row.scheme, options.coreBaseIri) : '';
		if (row.scheme && !schemes.has(schemeIri)) schemes.set(schemeIri, { iri: schemeIri, name: row.scheme, description: '', title: '', creator: '', publisher: '', rights: '' });
		concepts.set(iri, {
			iri, prefLabels: row.label, altLabels: row.alt, hiddenLabels: row.hidden, definition: row.definition, scopeNote: '', notation: row.notation,
			example: [], editorialNote: [], schemeIri, topConcept: false, broader: [], related: [], mappings: []
		});
		iriOfRow.set(row, iri);
		unique.push(row);
	}

	// Reference resolution: `label <iri>`, an IRI, a notation or a label, in the file first and then in the vocabulary.
	const byLabel = new Map<string, string>();
	const byNotation = new Map<string, string>();
	for (const c of options.existing ?? []) {
		for (const l of c.prefLabels) byLabel.set(l.text.trim().toLowerCase(), c.iri);
		for (const n of c.notation ?? []) byNotation.set(n, c.iri);
	}
	for (const c of concepts.values()) {
		for (const l of c.prefLabels) byLabel.set(l.text.trim().toLowerCase(), c.iri);
		for (const n of c.notation) byNotation.set(n, c.iri);
	}
	const resolve = (ref: string): string | null => {
		const { label, iri } = parseRef(ref);
		if (iri) return iri;
		return byNotation.get(label) ?? byLabel.get(label.toLowerCase()) ?? null;
	};

	let lastAt: (string | undefined)[] = [];
	for (const row of unique) {
		const c = concepts.get(iriOfRow.get(row)!)!;
		if (indented && row.level > 0) {
			lastAt[row.level] = c.iri;
			lastAt = lastAt.slice(0, row.level + 1);
			if (row.level === 1) c.topConcept = true;
			else if (lastAt[row.level - 1]) c.broader.push(lastAt[row.level - 1]!);
			else errors.push({ code: 'unknown-parent', row: row.number, iri: c.iri, message: `Row ${row.number}: "${row.levelLabel}" is on level ${row.level} but no concept of level ${row.level - 1} comes before it` });
		}
		for (const ref of row.broader) {
			const target = resolve(ref);
			if (!target) errors.push({ code: 'unknown-parent', row: row.number, iri: c.iri, message: `Row ${row.number}: the broader concept "${ref}" is neither in the file nor in the vocabulary` });
			else if (target === c.iri) errors.push({ code: 'reflexive-relation', row: row.number, iri: c.iri, message: `Row ${row.number}: "${ref}" is the concept itself` });
			else if (!c.broader.includes(target)) c.broader.push(target);
		}
		for (const ref of row.related) {
			const target = resolve(ref);
			if (!target) info.push({ code: 'undefined-concept', row: row.number, iri: c.iri, message: `Row ${row.number}: the related concept "${ref}" is neither in the file nor in the vocabulary` });
			else if (target === c.iri) errors.push({ code: 'reflexive-relation', row: row.number, iri: c.iri, message: `Row ${row.number}: "${ref}" is the concept itself` });
			else if (!c.related.includes(target)) c.related.push(target);
		}
	}
	if (!indented) {
		// Flat layout: a concept with no broader concept heads its scheme, as in the book's spreadsheet.
		for (const c of concepts.values()) if (c.schemeIri && c.broader.length === 0) c.topConcept = true;
	}
	for (const c of concepts.values()) {
		for (const r of c.related) {
			const other = concepts.get(r);
			if (other && !other.related.includes(c.iri)) other.related.push(c.iri);
		}
	}
	return { schemes: [...schemes.values()], concepts: [...concepts.values()], collections: [], skipped: [], errors, info };
}
