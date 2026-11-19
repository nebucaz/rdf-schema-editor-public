/**
 * Where an import lands (spec/vocabulary-graph-and-tabs): two optional changes applied to a parsed file before the
 * preview, so a sample or an export from another system can be taken into this vocabulary without editing the file.
 * Pure: it only rewrites the parsed model.
 *
 *  - `fromBase` -> `toBase`: every IRI that starts with `fromBase` (schemes, concepts, collections, and every link to
 *    them: broader, related, mapping targets, collection members) starts with `toBase` instead. IRIs outside
 *    `fromBase` (external mapping targets, other vocabularies) are left alone.
 *  - `scheme`: every concept moves into one scheme, an existing one (nothing else is written for it) or a new one the
 *    import creates. The file's own schemes are then not imported. `topConcept` flags stay as they are.
 */
import { isSafeSparqlIri } from '#lib/utils/sparql-safe.js';
import type { ImportedScheme, ParsedImport } from './skos-import';

export type SchemeTarget = { kind: 'existing'; iri: string } | { kind: 'new'; iri: string; name: string };

export interface RetargetOptions {
	fromBase?: string;
	toBase?: string;
	scheme?: SchemeTarget | null;
}

/** The longest IRI prefix, ending at `#` or `/`, that every concept of the file shares ('' when they share none). */
export function commonImportBase(parsed: Pick<ParsedImport, 'concepts' | 'schemes'>): string {
	const iris = [...parsed.concepts.map((c) => c.iri), ...parsed.schemes.map((s) => s.iri)];
	if (iris.length === 0) return '';
	let prefix = iris[0];
	for (const iri of iris) {
		let i = 0;
		while (i < prefix.length && i < iri.length && prefix[i] === iri[i]) i++;
		prefix = prefix.slice(0, i);
	}
	const cut = Math.max(prefix.lastIndexOf('#'), prefix.lastIndexOf('/'));
	return cut < 0 ? '' : prefix.slice(0, cut + 1);
}

/** A problem with the options, in the user's words, or null. */
export function retargetProblem(options: RetargetOptions): string | null {
	const from = options.fromBase?.trim() ?? '';
	const to = options.toBase?.trim() ?? '';
	if (from || to) {
		if (!from) return 'Enter the IRI start to replace, or clear the new IRI start';
		if (!to) return 'Enter the new IRI start';
		if (!isSafeSparqlIri(to)) return 'The new IRI start is not a valid IRI';
	}
	const target = options.scheme;
	if (target?.kind === 'new' && !target.name.trim()) return 'Give the new scheme a name';
	if (target && !isSafeSparqlIri(target.iri)) return 'The scheme IRI is not a valid IRI';
	return null;
}

export function retargetImport(parsed: ParsedImport, options: RetargetOptions): ParsedImport {
	const problem = retargetProblem(options);
	if (problem) throw new Error(problem);
	const from = options.fromBase?.trim() ?? '';
	const to = options.toBase?.trim() ?? '';
	const rewrite = (iri: string) => (from && from !== to && iri.startsWith(from) ? to + iri.slice(from.length) : iri);
	const target = options.scheme ?? null;

	const schemes: ImportedScheme[] = target
		? target.kind === 'new'
			? [{ iri: target.iri, name: target.name.trim(), description: '', title: '', creator: '', publisher: '', rights: '' }]
			: []
		: parsed.schemes.map((s) => ({ ...s, iri: rewrite(s.iri) }));
	const info = [...parsed.info];
	if (target && parsed.schemes.length > 0) {
		info.push({
			code: 'scheme-replaced',
			message: `The file's ${parsed.schemes.length === 1 ? 'scheme is' : 'schemes are'} not imported; every concept goes into the chosen scheme`
		});
	}

	return {
		...parsed,
		schemes,
		concepts: parsed.concepts.map((c) => ({
			...c,
			iri: rewrite(c.iri),
			schemeIri: target ? target.iri : rewrite(c.schemeIri),
			broader: c.broader.map(rewrite),
			related: c.related.map(rewrite),
			mappings: c.mappings.map((m) => ({ ...m, target: rewrite(m.target) }))
		})),
		collections: parsed.collections.map((col) => ({ ...col, iri: rewrite(col.iri), members: col.members.map(rewrite) })),
		info
	};
}
