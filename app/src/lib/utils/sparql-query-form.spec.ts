import { describe, it, expect } from 'vitest';
import { detectQueryForm } from './sparql-query-form';

describe('detectQueryForm', () => {
	it('detects a plain SELECT query', () => {
		expect(detectQueryForm('SELECT ?s ?p ?o WHERE { ?s ?p ?o }')).toBe('select');
	});

	it('detects a plain ASK query, case-insensitively', () => {
		expect(detectQueryForm('ask { ?s ?p ?o }')).toBe('ask');
	});

	it('skips leading PREFIX declarations before SELECT', () => {
		const query = `PREFIX ex: <http://example.org/>\nPREFIX : <http://default.org/>\nSELECT * WHERE { ?s ?p ?o }`;
		expect(detectQueryForm(query)).toBe('select');
	});

	it('skips a leading BASE declaration before ASK', () => {
		const query = `BASE <http://example.org/>\nASK { ?s ?p ?o }`;
		expect(detectQueryForm(query)).toBe('ask');
	});

	it('skips leading whitespace and comments', () => {
		const query = `\n  # a comment about this query\n\nSELECT * WHERE { ?s ?p ?o }`;
		expect(detectQueryForm(query)).toBe('select');
	});

	it('returns unsupported for CONSTRUCT', () => {
		expect(detectQueryForm('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe('unsupported');
	});

	it('returns unsupported for DESCRIBE', () => {
		expect(detectQueryForm('DESCRIBE <http://example.org/x>')).toBe('unsupported');
	});

	it('returns unsupported for an empty or garbage string', () => {
		expect(detectQueryForm('')).toBe('unsupported');
		expect(detectQueryForm('not a query')).toBe('unsupported');
	});

	it('does not confuse SELECT-like text inside a PREFIX IRI', () => {
		const query = `PREFIX select: <http://example.org/select#>\nASK { ?s ?p ?o }`;
		expect(detectQueryForm(query)).toBe('ask');
	});
});
