/**
 * Thesaurus expansion of a search term (skos-support STORY-426): the query is resolved to concepts through any of
 * their labels (exact, ignoring case and accents), then widened with the other labels of those concepts and,
 * optionally, with the labels of their narrower (and broader) concepts. Visible terms become chips the reader can
 * switch off; hidden labels widen the search but are never listed. Pure; it only reads the loaded vocabulary.
 */
import { normaliseLabel, type Concept } from './skos-concept';

/** Extra terms one search may carry, hidden labels included; keeps the generated query small. */
export const MAX_EXPANSION_TERMS = 20;

export interface ExpansionOptions {
	narrower: boolean;
	broader: boolean;
	/** Levels of narrower concepts to follow; one by default. */
	depth?: number;
}

export interface ExpansionChip {
	/** The label as stored; also what is searched. */
	term: string;
	/** Normalised term; the key a chip is switched off by. */
	key: string;
	via: 'synonym' | 'narrower' | 'broader';
}

export interface Expansion {
	query: string;
	chips: ExpansionChip[];
	/** Hidden labels of the concepts involved: searched, never shown. */
	hiddenTerms: string[];
	/** True when the cap cut terms off. */
	truncated: boolean;
}

const labelsOf = (c: Concept) => [...c.prefLabels, ...c.altLabels].map((l) => l.text.trim()).filter(Boolean);

function reachable(concepts: Concept[], start: Concept[], step: (c: Concept) => Concept[], depth: number): Concept[] {
	const seen = new Set(start.map((c) => c.iri));
	const found: Concept[] = [];
	let frontier = start;
	for (let level = 0; level < depth && frontier.length; level++) {
		const next: Concept[] = [];
		for (const c of frontier) {
			for (const n of step(c)) {
				if (seen.has(n.iri)) continue;
				seen.add(n.iri);
				found.push(n);
				next.push(n);
			}
		}
		frontier = next;
	}
	return found;
}

export function expandQuery(concepts: Concept[], query: string, options: ExpansionOptions): Expansion {
	const wanted = normaliseLabel(query);
	const empty: Expansion = { query, chips: [], hiddenTerms: [], truncated: false };
	if (!wanted || concepts.length === 0) return empty;
	const matched = concepts.filter((c) =>
		[...c.prefLabels, ...c.altLabels, ...c.hiddenLabels].some((l) => normaliseLabel(l.text) === wanted)
	);
	if (matched.length === 0) return empty;

	const byIri = new Map(concepts.map((c) => [c.iri, c]));
	const depth = Math.max(1, options.depth ?? 1);
	const narrowerOf = (c: Concept) => concepts.filter((x) => x.broader?.includes(c.iri));
	const broaderOf = (c: Concept) => (c.broader ?? []).map((i) => byIri.get(i)).filter((x): x is Concept => !!x);

	const groups: { via: ExpansionChip['via']; concepts: Concept[] }[] = [{ via: 'synonym', concepts: matched }];
	if (options.narrower) groups.push({ via: 'narrower', concepts: reachable(concepts, matched, narrowerOf, depth) });
	if (options.broader) groups.push({ via: 'broader', concepts: reachable(concepts, matched, broaderOf, 1) });

	const taken = new Set([wanted]);
	const chips: ExpansionChip[] = [];
	const hiddenTerms: string[] = [];
	let truncated = false;
	const room = () => chips.length + hiddenTerms.length < MAX_EXPANSION_TERMS;
	for (const g of groups) {
		for (const c of g.concepts) {
			for (const term of labelsOf(c)) {
				const key = normaliseLabel(term);
				if (!key || taken.has(key)) continue;
				if (!room()) {
					truncated = true;
					continue;
				}
				taken.add(key);
				chips.push({ term, key, via: g.via });
			}
		}
	}
	for (const g of groups) {
		for (const c of g.concepts) {
			for (const l of c.hiddenLabels) {
				const key = normaliseLabel(l.text);
				if (!key || taken.has(key)) continue;
				if (!room()) {
					truncated = true;
					continue;
				}
				taken.add(key);
				hiddenTerms.push(l.text.trim());
			}
		}
	}
	return { query, chips, hiddenTerms, truncated };
}

/** The extra terms to send with the search: enabled chips plus hidden labels, within the cap. */
export function searchTerms(expansion: Expansion, switchedOff: ReadonlySet<string>): string[] {
	return [...expansion.chips.filter((c) => !switchedOff.has(c.key)).map((c) => c.term), ...expansion.hiddenTerms].slice(0, MAX_EXPANSION_TERMS);
}
