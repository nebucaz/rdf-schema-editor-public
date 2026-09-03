import { describe, it, expect } from 'vitest';
import {
	isEndpointVisible,
	isEdgeHidden,
	isExternalNodeHidden,
	buildExternalReferencingSources,
	filterListedNamespaces
} from './visibility';

describe('buildExternalReferencingSources', () => {
	it('collects sources per external target, skipping targets that have a namespace', () => {
		const namespaces = new Map([
			['core:A', 'https://example.org/core'],
			['core:B', 'https://example.org/core']
		]);
		const edges = [
			{ source: 'core:A', target: 'ext:Vocab' },
			{ source: 'core:B', target: 'ext:Vocab' },
			{ source: 'core:A', target: 'core:B' } // local-to-local, not external
		];
		const map = buildExternalReferencingSources(edges, namespaces);
		expect(map.get('ext:Vocab')).toEqual(['core:A', 'core:B']);
		expect(map.has('core:B')).toBe(false);
	});
});

describe('isExternalNodeHidden', () => {
	const namespaces = new Map([
		['core:A', 'ns1'],
		['core:B', 'ns2']
	]);

	it('is hidden when every referencing source is hidden', () => {
		const hidden = new Set(['ns1']);
		expect(isExternalNodeHidden(['core:A'], namespaces, hidden)).toBe(true);
	});

	it('stays visible when any referencing source is visible, even with others hidden', () => {
		const hidden = new Set(['ns1']);
		expect(isExternalNodeHidden(['core:A', 'core:B'], namespaces, hidden)).toBe(false);
	});

	it('is visible when it has no referencing sources at all', () => {
		expect(isExternalNodeHidden(undefined, namespaces, new Set(['ns1']))).toBe(false);
		expect(isExternalNodeHidden([], namespaces, new Set(['ns1']))).toBe(false);
	});
});

describe('isEndpointVisible', () => {
	const namespaces = new Map([['core:A', 'ns1']]);

	it('uses the namespace tag directly for a node with a namespace', () => {
		expect(isEndpointVisible('core:A', namespaces, new Set(['ns1']), new Map())).toBe(false);
		expect(isEndpointVisible('core:A', namespaces, new Set(), new Map())).toBe(true);
	});

	it('derives an external stub node (no namespace entry) from its referencing sources', () => {
		const externalReferencingSources = new Map([['ext:Vocab', ['core:A']]]);
		expect(isEndpointVisible('ext:Vocab', namespaces, new Set(['ns1']), externalReferencingSources)).toBe(
			false
		);
		expect(isEndpointVisible('ext:Vocab', namespaces, new Set(), externalReferencingSources)).toBe(true);
	});
});

describe('isEdgeHidden', () => {
	it('hides an inheritance edge into an external stub when the sole referencing source is hidden', () => {
		const namespaces = new Map([['core:A', 'ns1']]);
		const externalReferencingSources = new Map([['ext:Vocab', ['core:A']]]);
		expect(isEdgeHidden('core:A', 'ext:Vocab', namespaces, new Set(['ns1']), externalReferencingSources)).toBe(
			true
		);
	});

	it('keeps the inheritance edge visible when its source stays visible', () => {
		const namespaces = new Map([['core:A', 'ns1']]);
		const externalReferencingSources = new Map([['ext:Vocab', ['core:A']]]);
		expect(isEdgeHidden('core:A', 'ext:Vocab', namespaces, new Set(), externalReferencingSources)).toBe(false);
	});
});

// -- Workspace-membership composition (STORY-076) --------------------------------------------------
// `workspaceMembers` is a second, independent, ANDed hidden gate alongside the pre-existing
// namespace-only gate above — every test above omits it entirely (stays `undefined`, meaning "no
// workspace filtering"), pinning that the namespace-only behavior is unchanged when the new
// parameter isn't supplied at all (the plan's risk assessment).

describe('isEndpointVisible — combined namespace + workspace-membership gate', () => {
	const namespaces = new Map([['core:A', 'ns1']]);

	it('is hidden when visible by namespace but absent from the active Workspace', () => {
		const workspaceMembers = new Set<string>(); // core:A is not a member
		expect(isEndpointVisible('core:A', namespaces, new Set(), new Map(), workspaceMembers)).toBe(false);
	});

	it('is hidden when a Workspace member but hidden by namespace (both gates independently sufficient)', () => {
		const workspaceMembers = new Set(['core:A']);
		expect(isEndpointVisible('core:A', namespaces, new Set(['ns1']), new Map(), workspaceMembers)).toBe(false);
	});

	it('is visible only when namespace-visible AND a Workspace member', () => {
		const workspaceMembers = new Set(['core:A']);
		expect(isEndpointVisible('core:A', namespaces, new Set(), new Map(), workspaceMembers)).toBe(true);
	});
});

describe('isExternalNodeHidden — workspace-membership composition', () => {
	const namespaces = new Map([
		['core:A', 'ns1'],
		['core:B', 'ns2']
	]);

	it('is hidden when its sole referencing source is namespace-visible but not a Workspace member', () => {
		const workspaceMembers = new Set<string>(); // core:A is not a member
		expect(isExternalNodeHidden(['core:A'], namespaces, new Set(), workspaceMembers)).toBe(true);
	});

	it('stays visible when any referencing source is both namespace-visible and a Workspace member', () => {
		const workspaceMembers = new Set(['core:B']); // only core:B is a member; core:A isn't
		expect(isExternalNodeHidden(['core:A', 'core:B'], namespaces, new Set(), workspaceMembers)).toBe(false);
	});
});

describe('isEdgeHidden — workspace-membership composition', () => {
	it('hides an edge whose target is namespace-visible but not a Workspace member', () => {
		const namespaces = new Map([
			['core:A', 'ns1'],
			['core:B', 'ns1']
		]);
		const workspaceMembers = new Set(['core:A']); // core:B is not a member
		expect(isEdgeHidden('core:A', 'core:B', namespaces, new Set(), new Map(), workspaceMembers)).toBe(true);
	});

	it('keeps an edge visible when both endpoints are namespace-visible and Workspace members', () => {
		const namespaces = new Map([
			['core:A', 'ns1'],
			['core:B', 'ns1']
		]);
		const workspaceMembers = new Set(['core:A', 'core:B']);
		expect(isEdgeHidden('core:A', 'core:B', namespaces, new Set(), new Map(), workspaceMembers)).toBe(false);
	});
});

describe('filterListedNamespaces (STORY-097)', () => {
	it('excludes a namespace with listedInFilter: false', () => {
		const namespaces = [
			{ baseIri: 'ns1', listedInFilter: true },
			{ baseIri: 'ns2', listedInFilter: false }
		];
		expect(filterListedNamespaces(namespaces)).toEqual([{ baseIri: 'ns1', listedInFilter: true }]);
	});

	it('keeps every namespace when all are listed', () => {
		const namespaces = [
			{ baseIri: 'ns1', listedInFilter: true },
			{ baseIri: 'ns2', listedInFilter: true }
		];
		expect(filterListedNamespaces(namespaces)).toEqual(namespaces);
	});
});
