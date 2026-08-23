import { describe, it, expect } from 'vitest';
import { highlightTurtle } from './turtle-highlight';

describe('highlightTurtle', () => {
	it('tags comments', () => {
		expect(highlightTurtle('# a comment')).toBe('<span class="ttl-comment"># a comment</span>');
	});

	it('tags IRIs', () => {
		expect(highlightTurtle('<http://example.org/Foo>')).toBe(
			'<span class="ttl-iri">&lt;http://example.org/Foo&gt;</span>'
		);
	});

	it('tags prefixed names, including a bare-colon default-prefix name', () => {
		expect(highlightTurtle('rdf:type')).toBe('<span class="ttl-prefixed">rdf:type</span>');
		expect(highlightTurtle(':Foo')).toBe('<span class="ttl-prefixed">:Foo</span>');
	});

	it('tags blank node labels', () => {
		expect(highlightTurtle('_:b1_node1')).toBe('<span class="ttl-bnode">_:b1_node1</span>');
	});

	it('tags @prefix/@base directives and language tags identically as at-words', () => {
		expect(highlightTurtle('@prefix')).toBe('<span class="ttl-at">@prefix</span>');
		expect(highlightTurtle('@en')).toBe('<span class="ttl-at">@en</span>');
	});

	it('tags quoted strings, including escaped quotes', () => {
		expect(highlightTurtle('"hello \\"world\\""')).toBe(
			'<span class="ttl-string">"hello \\"world\\""</span>'
		);
	});

	it('tags triple-quoted (multiline) strings as one token', () => {
		expect(highlightTurtle('"""line one\nline two"""')).toBe(
			'<span class="ttl-string">"""line one\nline two"""</span>'
		);
	});

	it('tags numbers', () => {
		expect(highlightTurtle('42')).toBe('<span class="ttl-number">42</span>');
		expect(highlightTurtle('-3.14')).toBe('<span class="ttl-number">-3.14</span>');
	});

	it('tags the standalone "a" keyword but not letters inside a larger token', () => {
		expect(highlightTurtle('a')).toBe('<span class="ttl-keyword">a</span>');
		expect(highlightTurtle('rse:application')).toBe(
			'<span class="ttl-prefixed">rse:application</span>'
		);
	});

	it('tags statement punctuation', () => {
		expect(highlightTurtle('.')).toBe('<span class="ttl-punctuation">.</span>');
		expect(highlightTurtle(';')).toBe('<span class="ttl-punctuation">;</span>');
	});

	it('passes whitespace through unwrapped and escapes HTML-sensitive characters', () => {
		expect(highlightTurtle('a  a')).toBe(
			'<span class="ttl-keyword">a</span>  <span class="ttl-keyword">a</span>'
		);
	});

	it('renders a full triple as a sequence of tokens', () => {
		const html = highlightTurtle('rse:Foo a owl:Class .');
		expect(html).toBe(
			'<span class="ttl-prefixed">rse:Foo</span> ' +
				'<span class="ttl-keyword">a</span> ' +
				'<span class="ttl-prefixed">owl:Class</span> ' +
				'<span class="ttl-punctuation">.</span>'
		);
	});

	it('never throws on malformed input (unterminated string) and still makes progress', () => {
		expect(() => highlightTurtle('"unterminated')).not.toThrow();
		expect(highlightTurtle('"unterminated')).toContain('unterminated');
	});
});
