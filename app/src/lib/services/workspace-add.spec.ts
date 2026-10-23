import { describe, expect, it } from 'vitest';
import { classifyAddedElement } from './workspace-add';

const NS = 'http://example.org/core';
const hidden = new Set<string>();

describe('classifyAddedElement', () => {
	it('is "visible" when the node exists and its namespace is shown', () => {
		expect(classifyAddedElement({ hasNode: true, namespace: NS, hiddenNamespaces: hidden })).toBe('visible');
	});

	it('is "missing-node" when no canvas node exists for the added IRI, so the schema must be re-fetched', () => {
		expect(classifyAddedElement({ hasNode: false, namespace: undefined, hiddenNamespaces: hidden })).toBe('missing-node');
	});

	it('is "namespace-hidden" when the node exists but its namespace is hidden', () => {
		expect(classifyAddedElement({ hasNode: true, namespace: NS, hiddenNamespaces: new Set([NS]) })).toBe('namespace-hidden');
	});

	it('checks the missing node before the namespace', () => {
		expect(classifyAddedElement({ hasNode: false, namespace: NS, hiddenNamespaces: new Set([NS]) })).toBe('missing-node');
	});
});
