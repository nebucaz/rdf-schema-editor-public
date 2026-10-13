import { describe, it, expect } from 'vitest';
import { buildBuilderSchema } from './query-builder-schema';
import { parseSpl, type SplParseError } from './query-spl-parser';
import { formatSplError, shouldOfferSplMode } from './spl-error-format';
import { buildSocFetchedSchema, loadSocQuads, SOC_BASE_IRI } from './soc-test-support';

const schema = buildBuilderSchema(buildSocFetchedSchema(loadSocQuads()));
const fail = (text: string): SplParseError => {
	const r = parseSpl(text, schema, { namespaces: [SOC_BASE_IRI] });
	if (r.ok) throw new Error(`expected an error for: ${text}`);
	return r.error;
};

describe('formatSplError', () => {
	it('shows the offending line with a caret range for a single-line error', () => {
		const text = 'Alert | where titel="x"';
		const f = formatSplError(text, { message: 'Unknown field', start: 14, end: 19 });
		expect(f.line).toBe(1);
		expect(f.column).toBe(15);
		expect(f.lineText).toBe(text);
		expect(f.marker).toBe(' '.repeat(14) + '^'.repeat(5));
	});

	it('locates an error on a later line and reports line-relative columns', () => {
		const text = 'Alert\n| where titel="x"\n| fields title';
		const start = text.indexOf('titel');
		const f = formatSplError(text, { message: 'm', start, end: start + 5 });
		expect(f.line).toBe(2);
		expect(f.lineText).toBe('| where titel="x"');
		expect(f.column).toBe(9);
		expect(f.marker).toBe(' '.repeat(8) + '^'.repeat(5));
	});

	it('clamps a span that crosses a line end to the first line', () => {
		const text = 'Alert |\nwhere x';
		const f = formatSplError(text, { message: 'm', start: 6, end: text.length });
		expect(f.line).toBe(1);
		expect(f.marker).toBe(' '.repeat(6) + '^');
	});

	it('keeps tabs in the marker prefix so the caret lines up', () => {
		const text = '\tAlert | frob';
		const start = text.indexOf('frob');
		const f = formatSplError(text, { message: 'm', start, end: start + 4 });
		expect(f.marker.startsWith('\t')).toBe(true);
		expect(f.marker.endsWith('^^^^')).toBe(true);
	});

	it('counts astral characters as one column', () => {
		const text = '😀😀 x';
		const start = text.indexOf('x');
		const f = formatSplError(text, { message: 'm', start, end: start + 1 });
		expect(f.column).toBe(4);
		expect(f.marker).toBe('   ^');
	});

	it('draws at least one caret for an empty span, and at end of input', () => {
		const f = formatSplError('Alert |', { message: 'm', start: 7, end: 7 });
		expect(f.marker).toBe(' '.repeat(7) + '^');
	});

	it('clamps out-of-range offsets instead of throwing', () => {
		const f = formatSplError('abc', { message: 'm', start: 99, end: 120 });
		expect(f.line).toBe(1);
		expect(f.marker).toBe('   ^');
	});

	it('carries suggestions and the help topic through', () => {
		const f = formatSplError('x', { message: 'm', start: 0, end: 1, expected: ['a', 'b'], helpTopic: 'spl-unsupported' });
		expect(f.suggestions).toEqual(['a', 'b']);
		expect(f.helpTopic).toBe('spl-unsupported');
	});

	describe('real parser errors', () => {
		it('unknown label', () => {
			const f = formatSplError('Alert | where titel="x"', fail('Alert | where titel="x"'));
			expect(f.marker).toMatch(/\^+$/);
			expect(f.message.length).toBeGreaterThan(0);
		});
		it('unsupported construct links to the docs topic', () => {
			const t = 'Alert | eval x=1';
			expect(formatSplError(t, fail(t)).helpTopic).toBe('spl-unsupported');
		});
		it('unterminated string', () => {
			const t = 'Alert | where title="abc';
			const f = formatSplError(t, fail(t));
			expect(f.lineText).toBe(t);
			expect(f.marker).toMatch(/\^/);
		});
		it('ambiguity lists candidates', () => {
			// any error with `expected` surfaces them as suggestions
			const t = 'Alert | where titel="x"';
			const e = fail(t);
			expect(formatSplError(t, e).suggestions).toEqual(e.expected ?? []);
		});
	});
});

describe('shouldOfferSplMode', () => {
	it('offers only for input containing a pipe', () => {
		expect(shouldOfferSplMode('Alert | fields title')).toBe(true);
		expect(shouldOfferSplMode('Alert|fields title')).toBe(true);
		expect(shouldOfferSplMode('login failures')).toBe(false);
		expect(shouldOfferSplMode('')).toBe(false);
	});
	it('stops offering when the pipe is removed', () => {
		expect(shouldOfferSplMode('Alert | ')).toBe(true);
		expect(shouldOfferSplMode('Alert ')).toBe(false);
	});
});
