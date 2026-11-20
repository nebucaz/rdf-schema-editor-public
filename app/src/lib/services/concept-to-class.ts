/**
 * Advice before promoting a concept to a class, and the plan for an enumerated class made from a collection
 * (skos-support STORY-424). Pure and advisory: nothing here blocks a save or a promotion.
 */
import { conceptTitle, primaryText, type Concept } from './skos-concept';
import type { SkosCollection } from './skos-collection';

/** Terms that usually belong in the vocabulary only (book: the CBox), as plain sentences for the dialog. */
export const PROMOTE_STAY_CRITERIA: readonly string[] = [
	'It is a status value, such as "open" or "closed".',
	'It is a tag or a category used to sort and find things.',
	'It is a capability or skill label.',
	'It is only a word that people need to agree on, with nothing to say about it in the model.'
];

/** Terms that need something the model can reason about. */
export const PROMOTE_CRITERIA: readonly string[] = [
	'It needs its own properties, for example an owner or a date.',
	'It needs restrictions, for example "every order has exactly one customer".',
	'It has subclasses, or instances that must be recognised as members of it.'
];

const EXAMPLE =
	'"Order status" and its values stay concepts: they only need a shared meaning. "Order" becomes a class: it has a customer, a date and lines, and a validation rule can refer to it.';

const KEEP_WORDS = /\b(status|state|tag|label|category|level|capabilit\w*|skill|priority|kind|type)\b/i;
const PROMOTE_WORDS = /\b(propert\w*|attribute\w*|must have|restriction\w*|subclass\w*|has an? )/i;

export interface PromoteGuidance {
	stay: readonly string[];
	promote: readonly string[];
	example: string;
	/** A hint from the concept's own words; `null` when nothing points either way. Never a rule. */
	lean: 'keep' | 'promote' | null;
}

export function promoteGuidance(concept: Concept): PromoteGuidance {
	const title = conceptTitle(concept);
	let lean: PromoteGuidance['lean'] = null;
	if (KEEP_WORDS.test(title)) lean = 'keep';
	else if (PROMOTE_WORDS.test(primaryText(concept.definitions))) lean = 'promote';
	return { stay: PROMOTE_STAY_CRITERIA, promote: PROMOTE_CRITERIA, example: EXAMPLE, lean };
}

export interface EnumerationMember {
	label: string;
	conceptIri: string;
}

export interface EnumerationPlan {
	error: string | null;
	className: string;
	members: EnumerationMember[];
}

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];

/** One member per live concept of the collection, nested collections included, in order, each once. Members
 *  carry the label only; the concept IRI is kept for the caller but no link is stored. */
export function planEnumeratedClass(
	collection: SkosCollection,
	collections: SkosCollection[],
	concepts: Concept[],
	options: { classExists?: (name: string) => boolean } = {}
): EnumerationPlan {
	const className = collection.prefLabels.find((l) => l.text.trim())?.text.trim() ?? '';
	const byIri = new Map(concepts.map((c) => [c.iri, c]));
	const nested = new Map(collections.map((x) => [x.iri, x]));
	const seen = new Set<string>([collection.iri]);
	const members: EnumerationMember[] = [];
	const walk = (list: string[]) => {
		for (const m of list) {
			const concept = byIri.get(m);
			if (concept) {
				if (LIVE.includes(concept.status) && !members.some((x) => x.conceptIri === m)) {
					members.push({ label: conceptTitle(concept), conceptIri: m });
				}
				continue;
			}
			const inner = nested.get(m);
			if (inner && !seen.has(m)) {
				seen.add(m);
				walk(inner.members);
			}
		}
	};
	walk(collection.members);
	if (!className) return { error: 'The collection needs a label to name the class', className, members: [] };
	if (members.length === 0) return { error: 'The collection has no concepts to turn into members', className, members: [] };
	if (options.classExists?.(className)) return { error: `A class named "${className}" already exists`, className, members: [] };
	return { error: null, className, members };
}
