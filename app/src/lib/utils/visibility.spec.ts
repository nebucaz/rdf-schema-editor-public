import { describe, it, expect } from 'vitest';
import {
	isEndpointVisible,
	isEdgeHidden,
	isExternalNodeHidden,
	buildExternalReferencingSources
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
