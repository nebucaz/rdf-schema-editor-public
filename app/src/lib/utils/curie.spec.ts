import { describe, it, expect } from 'vitest';
import { toCurie, curieifyText, namespaceOf, type NamespacePrefixEntry } from './curie';

const NAMESPACES: NamespacePrefixEntry[] = [
	{ baseIri: 'http://ld.pageagent.com/rdf-schema-editor/backstage', prefix: 'backstage' },
	{ baseIri: 'http://ld.pageagent.com/rdf-schema-editor/gov', prefix: 'gov' }
];

describe('toCurie', () => {
	it('compacts an instances-graph IRI to prefix:LocalName', () => {
		expect(toCurie('http://ld.pageagent.com/rdf-schema-editor/backstage#Component', NAMESPACES)).toBe(
			'backstage:Component'
		);
	});

	it('compacts a derived /schema graph IRI to the same bare prefix', () => {
		expect(toCurie('http://ld.pageagent.com/rdf-schema-editor/backstage/schema#Component', NAMESPACES)).toBe(
			'backstage:Component'
		);
	});

	it('compacts a derived /shapes graph IRI to the same bare prefix', () => {
		expect(
			toCurie('http://ld.pageagent.com/rdf-schema-editor/backstage/shapes#ComponentShape', NAMESPACES)
		).toBe('backstage:ComponentShape');
	});

	it('picks the longest matching base so /schema is not swallowed by the plain instances base', () => {
		expect(toCurie('http://ld.pageagent.com/rdf-schema-editor/backstage/schema#Foo', NAMESPACES)).toBe(
			'backstage:Foo'
		);
	});

	it('returns the IRI unchanged when no namespace matches', () => {
		const iri = 'http://www.w3.org/2001/XMLSchema#string';
		expect(toCurie(iri, NAMESPACES)).toBe(iri);
	});

	it('ignores a namespace entry with an empty prefix', () => {
		const iri = 'http://ld.pageagent.com/rdf-schema-editor/unlabeled#Thing';
		expect(toCurie(iri, [{ baseIri: 'http://ld.pageagent.com/rdf-schema-editor/unlabeled', prefix: '' }])).toBe(
			iri
		);
	});
});

describe('curieifyText', () => {
	it('compacts every embedded IRI in a minCount/maxCount-style message', () => {
		const message =
			'expected at least 1 value(s) for http://ld.pageagent.com/rdf-schema-editor/backstage#owner, found 0';
		expect(curieifyText(message, NAMESPACES)).toBe('expected at least 1 value(s) for backstage:owner, found 0');
	});

	it('compacts multiple space-separated IRIs (sh:or target-class list)', () => {
		const message =
			'expected http://ld.pageagent.com/rdf-schema-editor/backstage#e1 to be of type ' +
			'http://ld.pageagent.com/rdf-schema-editor/backstage#Team or ' +
			'http://ld.pageagent.com/rdf-schema-editor/gov#Team for http://ld.pageagent.com/rdf-schema-editor/backstage#owner';
		expect(curieifyText(message, NAMESPACES)).toBe(
			'expected backstage:e1 to be of type backstage:Team or gov:Team for backstage:owner'
		);
	});

	it('leaves text with no embedded IRI unchanged', () => {
		expect(curieifyText('expected at least 1 value(s), found 0', NAMESPACES)).toBe(
			'expected at least 1 value(s), found 0'
		);
	});

	it('leaves an IRI from an unregistered namespace unchanged', () => {
		const message = 'expected datatype http://www.w3.org/2001/XMLSchema#string for backstage:age, found string';
		expect(curieifyText(message, NAMESPACES)).toBe(message);
	});
});

describe('namespaceOf', () => {
	it('resolves an instances-graph IRI to its namespace base IRI', () => {
		expect(namespaceOf('http://ld.pageagent.com/rdf-schema-editor/backstage#e1', NAMESPACES)).toBe(
			'http://ld.pageagent.com/rdf-schema-editor/backstage'
		);
	});

	it('resolves a derived /schema graph IRI to the same namespace base IRI', () => {
		expect(namespaceOf('http://ld.pageagent.com/rdf-schema-editor/backstage/schema#Component', NAMESPACES)).toBe(
			'http://ld.pageagent.com/rdf-schema-editor/backstage'
		);
	});

	it('returns null when no namespace matches', () => {
		expect(namespaceOf('http://www.w3.org/2001/XMLSchema#string', NAMESPACES)).toBeNull();
	});
});
