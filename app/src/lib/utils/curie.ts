/**
 * IRI -> `prefix:LocalName` compaction against this app's registered namespaces, for read-only
 * display surfaces (the validation report — STORY-132) where nothing is ever re-parsed back into
 * Turtle. Unlike `turtle.ts`'s round-trip-safe `buildDisplayPrefixes` (which mints distinguishable
 * `<prefix>`/`<prefix>_sh`/`<prefix>_i` prefixes for a namespace's schema/shapes/instances graphs,
 * since a Turtle parser needs to tell them apart), every one of a namespace's three graph bases
 * (`config.ts`'s `namespaceGraphs`) collapses onto the same bare prefix here — a reader only needs
 * to recognize *which namespace* an IRI belongs to.
 */
import { namespaceGraphs } from '$lib/config';

export interface NamespacePrefixEntry {
	baseIri: string;
	prefix: string;
}

interface PrefixCandidate {
	base: string;
	prefix: string;
	namespaceBaseIri: string;
}

/** Longest-base-first candidate list, so `<base>/schema#X` matches the schema graph rather than the
 *  shorter plain instances base it also happens to start with. */
function buildCandidates(namespaces: NamespacePrefixEntry[]): PrefixCandidate[] {
	const candidates: PrefixCandidate[] = [];
	for (const ns of namespaces) {
		if (!ns.prefix || !ns.baseIri) continue;
		const graphs = namespaceGraphs(ns.baseIri);
		candidates.push({ base: graphs.instances, prefix: ns.prefix, namespaceBaseIri: ns.baseIri });
		candidates.push({ base: graphs.schema, prefix: ns.prefix, namespaceBaseIri: ns.baseIri });
		candidates.push({ base: graphs.shapes, prefix: ns.prefix, namespaceBaseIri: ns.baseIri });
	}
	return candidates.sort((a, b) => b.base.length - a.base.length);
}

/** Compacts one `<base>#LocalName` IRI to `prefix:LocalName`; returns `iri` unchanged if no
 *  registered namespace's base matches (an external vocabulary IRI, or a namespace deleted since the
 *  IRI was minted). */
export function toCurie(iri: string, namespaces: NamespacePrefixEntry[]): string {
	for (const { base, prefix } of buildCandidates(namespaces)) {
		if (iri.startsWith(`${base}#`)) {
			return `${prefix}:${iri.slice(base.length + 1)}`;
		}
	}
	return iri;
}

/** The registered namespace `iri` belongs to (its own base IRI, not the CURIE prefix) — `null` when
 *  no namespace's instances/`/schema`/`/shapes` base matches. Lets a caller filter a list of IRIs by
 *  namespace membership (the validation report's namespace filter) without re-deriving `toCurie`'s
 *  prefix string and mapping it back. */
export function namespaceOf(iri: string, namespaces: NamespacePrefixEntry[]): string | null {
	for (const { base, namespaceBaseIri } of buildCandidates(namespaces)) {
		if (iri.startsWith(`${base}#`)) {
			return namespaceBaseIri;
		}
	}
	return null;
}

// IRIs interpolated into free text never contain whitespace or a comma (the app never mints one
// that would), so both are safe token boundaries — this also keeps a trailing ", found 3"-style
// clause out of the match.
const IRI_TOKEN = /https?:\/\/[^\s,]+/g;

/** Compacts every recognizable IRI embedded in free text — `internal/validation/check.go`'s
 *  `Violation.message` interpolates raw property/class/datatype IRIs via `fmt.Sprintf`, which this
 *  turns back into readable `prefix:LocalName` form wherever the IRI's namespace is registered. Text
 *  with no embedded IRI, or one from an unregistered namespace/vocabulary (e.g. `xsd:`), passes
 *  through unchanged. */
export function curieifyText(text: string, namespaces: NamespacePrefixEntry[]): string {
	const candidates = buildCandidates(namespaces);
	return text.replace(IRI_TOKEN, (token) => {
		for (const { base, prefix } of candidates) {
			if (token.startsWith(`${base}#`)) {
				return `${prefix}:${token.slice(base.length + 1)}`;
			}
		}
		return token;
	});
}
