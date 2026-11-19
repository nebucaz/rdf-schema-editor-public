/**
 * The drawable model of a SKOS scheme (vocabulary-graph-and-tabs STORY-451): nodes with positions, links, and the
 * neighbourhood of one concept. Built on `buildTaxonomy`, so orphan, cycle and polyhierarchy markers agree with the
 * outline. Pure; no GraphDB access and no DOM.
 */
import { hierarchy, tree } from 'd3';
import { conceptTitle, schemeDisplayName, type Concept, type ConceptScheme, type MappingKind } from './skos-concept';
import { buildTaxonomy, type TaxonomyMarker, type TaxonomyNode } from './taxonomy-tree';

export const DEFAULT_MAX_GRAPH_NODES = 300;

/** Spacing of the top-down layout, in px. */
const NODE_GAP = 150;
const LEVEL_GAP = 90;
const RADIAL_LEVEL = 140;

export type GraphLinkKind = 'broader' | 'duplicate-of' | 'related' | MappingKind;

export interface GraphNode {
	/** Unique per placement: the concept IRI, or `<iri>#<n>` for the second and later places a polyhierarchy concept appears. */
	id: string;
	iri: string;
	label: string;
	depth: number;
	markers: TaxonomyMarker[];
	/** For a polyhierarchy repeat, the `id` of the first placement of the same concept. */
	duplicateOf?: string;
	/** Children left out because of the node cap; `expand(iri)` reveals them. */
	hiddenChildren: number;
	x: number;
	y: number;
}

export interface GraphLink {
	from: string;
	to: string;
	kind: GraphLinkKind;
}

export interface SchemeGraph {
	schemeName: string;
	nodes: GraphNode[];
	links: GraphLink[];
	/** True while some node still hides children. */
	truncated: boolean;
	/** The same graph with one more level shown below `iri`. */
	expand(iri: string): SchemeGraph;
}

export interface SchemeGraphOptions {
	schemeIri: string;
	layers?: { related?: boolean; mappings?: boolean };
	/** Default `DEFAULT_MAX_GRAPH_NODES`. */
	maxNodes?: number;
	layout?: 'tree' | 'radial';
	/** Concept IRIs whose next level was revealed with `expand`. */
	expanded?: string[];
}

interface Placed {
	node: GraphNode;
	children: Placed[];
}

export function buildSchemeGraph(concepts: Concept[], schemes: ConceptScheme[], options: SchemeGraphOptions): SchemeGraph {
	const maxNodes = options.maxNodes ?? DEFAULT_MAX_GRAPH_NODES;
	const expanded = new Set(options.expanded ?? []);
	const roots = buildTaxonomy(concepts, options.schemeIri);

	const perDepth: number[] = [];
	const count = (n: TaxonomyNode) => {
		perDepth[n.depth] = (perDepth[n.depth] ?? 0) + 1;
		n.children.forEach(count);
	};
	roots.forEach(count);
	const total = perDepth.reduce((a, b) => a + b, 0);

	// The deepest level whose levels above it together fit the cap (-1: not even the roots do).
	let cutoff = Infinity;
	if (total > maxNodes) {
		cutoff = -1;
		let running = 0;
		for (let d = 0; d < perDepth.length; d++) {
			running += perDepth[d];
			if (running > maxNodes) break;
			cutoff = d;
		}
	}

	const seen = new Map<string, number>();
	const place = (t: TaxonomyNode): Placed => {
		const times = seen.get(t.iri) ?? 0;
		seen.set(t.iri, times + 1);
		const id = times === 0 ? t.iri : `${t.iri}#${times}`;
		const open = t.depth < cutoff || expanded.has(t.iri);
		const shown = open ? t.children : [];
		const placed: Placed = {
			node: {
				id,
				iri: t.iri,
				label: t.label,
				depth: t.depth,
				markers: t.markers,
				...(times > 0 ? { duplicateOf: t.iri } : {}),
				hiddenChildren: t.children.length - shown.length,
				x: 0,
				y: 0
			},
			children: []
		};
		placed.children = shown.map(place);
		return placed;
	};

	const keptRoots = cutoff < 0 ? roots.slice(0, maxNodes) : roots;
	const placedRoots = keptRoots.map(place);
	const rootsCut = roots.length - keptRoots.length > 0;

	layout(placedRoots, options.layout ?? 'tree');

	const nodes: GraphNode[] = [];
	const links: GraphLink[] = [];
	const walk = (p: Placed, parent: Placed | null) => {
		nodes.push(p.node);
		if (parent) links.push({ from: parent.node.id, to: p.node.id, kind: 'broader' });
		if (p.node.duplicateOf) links.push({ from: p.node.id, to: p.node.duplicateOf, kind: 'duplicate-of' });
		p.children.forEach((c) => walk(c, p));
	};
	placedRoots.forEach((r) => walk(r, null));
	// A repeat whose first placement is not drawn has nothing to point at.
	const ids = new Set(nodes.map((n) => n.id));
	const drawnLinks = links.filter((l) => ids.has(l.from) && ids.has(l.to));

	addLayers(drawnLinks, nodes, concepts, options);

	return {
		schemeName: schemeDisplayName(schemes.find((s) => s.iri === options.schemeIri) ?? { iri: options.schemeIri, name: '' }),
		nodes,
		links: drawnLinks,
		truncated: rootsCut || nodes.some((n) => n.hiddenChildren > 0),
		expand: (iri) => buildSchemeGraph(concepts, schemes, { ...options, expanded: [...expanded, iri] })
	};
}

/** `related` and mapping links between concepts that are both drawn, attached to the first placement of each. */
function addLayers(links: GraphLink[], nodes: GraphNode[], concepts: Concept[], options: SchemeGraphOptions) {
	const layers = options.layers ?? {};
	if (!layers.related && !layers.mappings) return;
	const first = new Map<string, string>();
	for (const n of nodes) if (!n.duplicateOf) first.set(n.iri, n.id);
	const pairs = new Set<string>();
	for (const c of concepts) {
		const from = first.get(c.iri);
		if (!from) continue;
		if (layers.related) {
			for (const target of c.related ?? []) {
				const to = first.get(target);
				if (!to || to === from) continue;
				const key = [from, to].sort().join('|');
				if (pairs.has(key)) continue;
				pairs.add(key);
				links.push({ from, to, kind: 'related' });
			}
		}
		if (layers.mappings) {
			for (const m of c.mappings ?? []) {
				const to = first.get(m.target);
				if (to && to !== from) links.push({ from, to, kind: m.kind });
			}
		}
	}
}

/** Positions every placed node: a tidy top-down tree, or rings around the middle for `radial`. */
function layout(roots: Placed[], mode: 'tree' | 'radial') {
	if (roots.length === 0) return;
	// A scheme usually has several roots, so they hang from an invisible one.
	const virtual: Placed = { node: null as unknown as GraphNode, children: roots };
	const h = hierarchy<Placed>(virtual, (p) => p.children);
	if (mode === 'radial') {
		tree<Placed>().size([2 * Math.PI, 1]).separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(h);
		for (const d of h.descendants()) {
			if (!d.data.node) continue;
			const r = d.depth * RADIAL_LEVEL;
			const angle = (d.x ?? 0) - Math.PI / 2;
			d.data.node.x = r * Math.cos(angle);
			d.data.node.y = r * Math.sin(angle);
		}
		return;
	}
	tree<Placed>().nodeSize([NODE_GAP, LEVEL_GAP])(h);
	for (const d of h.descendants()) {
		if (!d.data.node) continue;
		d.data.node.x = d.x ?? 0;
		d.data.node.y = (d.depth - 1) * LEVEL_GAP;
	}
}

export interface NeighborRef {
	iri: string;
	label: string;
}

export interface Neighborhood {
	center: NeighborRef | null;
	broader: NeighborRef[];
	narrower: NeighborRef[];
	related: NeighborRef[];
}

/** The concepts one hop from `iri`: its broader and narrower concepts and its related ones, whichever side states the relation. */
export function buildNeighborhood(concepts: Concept[], iri: string): Neighborhood {
	const byIri = new Map(concepts.map((c) => [c.iri, c]));
	const me = byIri.get(iri);
	if (!me) return { center: null, broader: [], narrower: [], related: [] };
	const ref = (c: Concept): NeighborRef => ({ iri: c.iri, label: conceptTitle(c) });
	const sorted = (set: Set<string>) =>
		[...set]
			.map((i) => byIri.get(i))
			.filter((c): c is Concept => !!c && c.iri !== iri)
			.map(ref)
			.sort((a, b) => a.label.localeCompare(b.label) || (a.iri < b.iri ? -1 : 1));
	const broader = new Set(me.broader ?? []);
	const narrower = new Set(concepts.filter((c) => (c.broader ?? []).includes(iri)).map((c) => c.iri));
	const related = new Set(me.related ?? []);
	for (const c of concepts) if ((c.related ?? []).includes(iri)) related.add(c.iri);
	return { center: ref(me), broader: sorted(broader), narrower: sorted(narrower), related: sorted(related) };
}
