/**
 * qSKOS-style health summary of each concept scheme (skos-support STORY-422). Pure and deterministic: computed
 * from the loaded concepts, no request, sorted output. Advisory like the gates; collections are not concepts and
 * never appear here, deprecated and retired concepts are left out.
 */
import type { Concept } from './skos-concept';

export interface UndefinedReference {
	concept: string;
	target: string;
}

export interface SchemeHealth {
	/** `''` for concepts that belong to no scheme. */
	schemeIri: string;
	conceptCount: number;
	/** No broader, narrower, related or mapping, and not a top concept. */
	orphans: string[];
	/** Top concepts with no relation of any kind; a count only, they are not defects to list. */
	topConceptsWithoutRelation: number;
	/** Connected groups over broader and related, largest first. */
	clusters: string[][];
	/** `skos:related` pairs where one concept is an ancestor, two or more levels up, of the other. */
	transitiveRelated: [string, string][];
	polyhierarchy: string[];
	/** Mean distance from a root; concepts caught in a cycle are not reachable and not counted. */
	averageDepth: number;
	/** Mean number of narrower concepts over the concepts that have any. */
	averageBranching: number;
	/** Broader or related targets that are not concepts of the vocabulary. */
	undefinedReferences: UndefinedReference[];
}

const LIVE: readonly string[] = ['proposed', 'approved', 'active'];
const sorted = (xs: Iterable<string>) => [...xs].sort();

function analyse(schemeIri: string, members: Concept[], known: Set<string>): SchemeHealth {
	const byIri = new Map(members.map((m) => [m.iri, m]));
	const parents = (m: Concept) => (m.broader ?? []).filter((p) => byIri.has(p));
	const children = new Map<string, string[]>();
	const links = new Map<string, Set<string>>(members.map((m) => [m.iri, new Set<string>()]));
	const hasRelation = new Set<string>();
	const undefinedReferences: UndefinedReference[] = [];
	const relatedPairs = new Map<string, [string, string]>();

	for (const m of members) {
		for (const p of m.broader ?? []) {
			if (!known.has(p)) undefinedReferences.push({ concept: m.iri, target: p });
			if (byIri.has(p)) {
				children.set(p, [...(children.get(p) ?? []), m.iri]);
				links.get(m.iri)!.add(p);
				links.get(p)!.add(m.iri);
			}
			if (known.has(p)) hasRelation.add(m.iri).add(p);
		}
		for (const r of m.related ?? []) {
			if (!known.has(r)) undefinedReferences.push({ concept: m.iri, target: r });
			else {
				hasRelation.add(m.iri).add(r);
				const pair = (m.iri < r ? [m.iri, r] : [r, m.iri]) as [string, string];
				relatedPairs.set(pair.join(' '), pair);
			}
			if (byIri.has(r)) {
				links.get(m.iri)!.add(r);
				links.get(r)!.add(m.iri);
			}
		}
		if (m.mappings?.length) hasRelation.add(m.iri);
	}

	const unrelated = members.filter((m) => !hasRelation.has(m.iri));
	const orphans = sorted(unrelated.filter((m) => !m.topConcept).map((m) => m.iri));
	const topConceptsWithoutRelation = unrelated.length - orphans.length;

	const seen = new Set<string>();
	const clusters: string[][] = [];
	for (const start of sorted(byIri.keys())) {
		if (seen.has(start)) continue;
		const group: string[] = [];
		const stack = [start];
		seen.add(start);
		while (stack.length) {
			const next = stack.pop()!;
			group.push(next);
			for (const n of links.get(next)!) if (!seen.has(n)) (seen.add(n), stack.push(n));
		}
		clusters.push(group.sort());
	}
	clusters.sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));

	// Ancestors at distance >= 2 for the transitive-related check.
	const farAncestors = (iri: string): Set<string> => {
		const out = new Set<string>();
		const visited = new Set<string>();
		let level = parents(byIri.get(iri)!);
		while (level.length) {
			const next: string[] = [];
			for (const p of level) {
				if (visited.has(p)) continue;
				visited.add(p);
				next.push(...parents(byIri.get(p)!));
			}
			for (const p of next) out.add(p);
			level = next;
		}
		return out;
	};
	const transitiveRelated = [...relatedPairs.values()]
		.filter(([a, b]) => byIri.has(a) && byIri.has(b) && (farAncestors(a).has(b) || farAncestors(b).has(a)))
		.sort((x, y) => (x.join(' ') < y.join(' ') ? -1 : 1));

	// Depth: breadth-first from the roots.
	const depth = new Map<string, number>();
	let frontier = sorted(members.filter((m) => parents(m).length === 0).map((m) => m.iri));
	frontier.forEach((i) => depth.set(i, 0));
	while (frontier.length) {
		const next: string[] = [];
		for (const p of frontier) {
			for (const ch of children.get(p) ?? []) {
				if (!depth.has(ch)) (depth.set(ch, depth.get(p)! + 1), next.push(ch));
			}
		}
		frontier = next;
	}
	const depths = [...depth.values()];
	const averageDepth = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
	const branch = [...children.values()].map((v) => v.length);
	const averageBranching = branch.length ? branch.reduce((a, b) => a + b, 0) / branch.length : 0;

	return {
		schemeIri,
		conceptCount: members.length,
		orphans,
		topConceptsWithoutRelation,
		clusters,
		transitiveRelated,
		polyhierarchy: sorted(members.filter((m) => parents(m).length > 1).map((m) => m.iri)),
		averageDepth,
		averageBranching,
		undefinedReferences: undefinedReferences.sort((a, b) => (a.concept + a.target < b.concept + b.target ? -1 : 1))
	};
}

/** One report per scheme, sorted by scheme IRI; `[]` for no concepts. */
export function analyseSchemeHealth(concepts: Concept[]): SchemeHealth[] {
	const known = new Set(concepts.map((c) => c.iri));
	const live = concepts.filter((c) => LIVE.includes(c.status));
	const groups = new Map<string, Concept[]>();
	for (const c of live) groups.set(c.schemeIri, [...(groups.get(c.schemeIri) ?? []), c]);
	return sorted(groups.keys()).map((s) => analyse(s, groups.get(s)!, known));
}

export type SchemeHealthDebtKind = 'orphan-concept' | 'disconnected-cluster' | 'undefined-reference';

export interface SchemeHealthDebt {
	kind: SchemeHealthDebtKind;
	/** The concept to open. */
	concept: string;
	detail: string;
}

/** The defects of the report, one item each; a cluster is reported by its first member, the largest cluster not at all. */
export function schemeHealthDebt(reports: SchemeHealth[], titleOf: (iri: string) => string = (i) => i): SchemeHealthDebt[] {
	const out: SchemeHealthDebt[] = [];
	for (const r of reports) {
		for (const o of r.orphans) out.push({ kind: 'orphan-concept', concept: o, detail: `"${titleOf(o)}" has no broader, narrower, related or mapped concept.` });
		for (const cl of r.clusters.slice(1)) {
			if (cl.length < 2) continue;
			out.push({
				kind: 'disconnected-cluster',
				concept: cl[0],
				detail: `${cl.length} concepts starting at "${titleOf(cl[0])}" are not connected to the rest of the scheme.`
			});
		}
		for (const u of r.undefinedReferences) {
			out.push({ kind: 'undefined-reference', concept: u.concept, detail: `"${titleOf(u.concept)}" points to ${u.target}, which is not a concept of the vocabulary.` });
		}
	}
	return out;
}

