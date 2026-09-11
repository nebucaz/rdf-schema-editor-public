import { describe, expect, it } from 'vitest';
import { mergeNeighborhood } from './neighborhood-merge';
import type { NeighborhoodGraph } from '$lib/services/sparql-connector';

const nodeA = { iri: 'urn:a', label: 'A', classIri: 'urn:Class', namespaceBaseIri: 'urn:ns' };
const nodeB = { iri: 'urn:b', label: 'B', classIri: 'urn:Class', namespaceBaseIri: 'urn:ns' };
const nodeC = { iri: 'urn:c', label: 'C', classIri: 'urn:Class', namespaceBaseIri: 'urn:ns' };

const linkAB = { source: 'urn:a', target: 'urn:b', predicateIri: 'urn:p', predicateLabel: 'p' };
const linkBC = { source: 'urn:b', target: 'urn:c', predicateIri: 'urn:p', predicateLabel: 'p' };

describe('mergeNeighborhood', () => {
	it('appends new nodes and links from an empty existing graph', () => {
		const existing: NeighborhoodGraph = { nodes: [], links: [] };
		const delta: NeighborhoodGraph = { nodes: [nodeA, nodeB], links: [linkAB] };

		const result = mergeNeighborhood(existing, delta);

		expect(result.nodes).toEqual([nodeA, nodeB]);
		expect(result.links).toEqual([linkAB]);
	});

	it('does not duplicate a node already present by iri', () => {
		const existing: NeighborhoodGraph = { nodes: [nodeA, nodeB], links: [linkAB] };
		const delta: NeighborhoodGraph = { nodes: [nodeB, nodeC], links: [linkBC] };

		const result = mergeNeighborhood(existing, delta);

		expect(result.nodes.map((n) => n.iri)).toEqual(['urn:a', 'urn:b', 'urn:c']);
	});

	it('overwrites an existing node with the re-fetched delta version', () => {
		const staleB = { ...nodeB, label: 'Stale B' };
		const existing: NeighborhoodGraph = { nodes: [nodeA, staleB], links: [linkAB] };
		const delta: NeighborhoodGraph = { nodes: [nodeB], links: [] };

		const result = mergeNeighborhood(existing, delta);

		expect(result.nodes.find((n) => n.iri === 'urn:b')?.label).toBe('B');
	});

	it('does not duplicate a link already present by (source, predicateIri, target)', () => {
		const existing: NeighborhoodGraph = { nodes: [nodeA, nodeB], links: [linkAB] };
		const delta: NeighborhoodGraph = { nodes: [nodeA, nodeB], links: [linkAB] };

		const result = mergeNeighborhood(existing, delta);

		expect(result.links).toEqual([linkAB]);
	});

	it('keeps two links between the same pair of nodes distinct by predicate', () => {
		const linkABOther = { ...linkAB, predicateIri: 'urn:q', predicateLabel: 'q' };
		const existing: NeighborhoodGraph = { nodes: [nodeA, nodeB], links: [linkAB] };
		const delta: NeighborhoodGraph = { nodes: [], links: [linkABOther] };

		const result = mergeNeighborhood(existing, delta);

		expect(result.links).toEqual([linkAB, linkABOther]);
	});

	it('never mutates the existing graph object', () => {
		const existing: NeighborhoodGraph = { nodes: [nodeA], links: [] };
		const delta: NeighborhoodGraph = { nodes: [nodeB], links: [linkAB] };

		mergeNeighborhood(existing, delta);

		expect(existing.nodes).toEqual([nodeA]);
		expect(existing.links).toEqual([]);
	});
});
