import { describe, it, expect } from 'vitest';
import { parseSplStages, tokenizeSpl, type SplToken } from './query-spl-parser';

const ok = (text: string): SplToken[] => {
	const r = tokenizeSpl(text);
	if (!r.ok) throw new Error(`unexpected error: ${r.error.message}`);
	return r.tokens;
};
const shape = (tokens: SplToken[]) => tokens.map((t) => [t.type, t.value]);

describe('tokenizeSpl', () => {
	it('tokenizes words, dotted paths, operators, numbers, parens and commas', () => {
		expect(shape(ok('where a.b.c>=5, like(x, "%v%")'))).toEqual([
			['ident', 'where'],
			['ident', 'a.b.c'],
			['op', '>='],
			['number', '5'],
			['comma', ','],
			['ident', 'like'],
			['lparen', '('],
			['ident', 'x'],
			['comma', ','],
			['string', '%v%'],
			['rparen', ')']
		]);
	});

	it('recognises every comparison operator', () => {
		const ops = ['=', '==', '!=', '<', '<=', '>', '>='];
		for (const op of ops) expect(shape(ok(`a${op}1`))[1]).toEqual(['op', op]);
	});

	it('reads signed and decimal numbers, and a minus before a name', () => {
		expect(shape(ok('count>-3.5'))).toEqual([['ident', 'count'], ['op', '>'], ['number', '-3.5']]);
		expect(shape(ok('-count'))).toEqual([['minus', '-'], ['ident', 'count']]);
		expect(shape(ok('1e3'))).toEqual([['number', '1e3']]);
	});

	it('keeps a number with a unit suffix as one word (relative time)', () => {
		expect(shape(ok('earliest=-24h'))).toEqual([['ident', 'earliest'], ['op', '='], ['ident', '-24h']]);
	});

	it('unescapes quoted strings and keeps a pipe inside them', () => {
		const t = ok('"a|b" "q\\"x" "back\\\\slash" "l1\\nl2"');
		expect(t.map((x) => x.value)).toEqual(['a|b', 'q"x', 'back\\slash', 'l1\nl2']);
		expect(t.every((x) => x.type === 'string')).toBe(true);
	});

	it('carries offsets, line and column (1-based) across newlines', () => {
		const t = ok('abc\n  "x y"\n>=');
		expect(t[0]).toMatchObject({ start: 0, end: 3, line: 1, column: 1 });
		expect(t[1]).toMatchObject({ start: 6, end: 11, line: 2, column: 3 });
		expect(t[2]).toMatchObject({ start: 12, end: 14, line: 3, column: 1 });
	});

	it('reports an unterminated string at its opening quote', () => {
		const r = tokenizeSpl('a = "oops');
		expect(r).toMatchObject({ ok: false, error: { start: 4, end: 9 } });
		if (!r.ok) expect(r.error.message).toMatch(/unterminated string/i);
	});

	it('reports an unterminated paren at its opening position, and a stray closer', () => {
		const open = tokenizeSpl('x IN ("a", "b"');
		expect(open).toMatchObject({ ok: false, error: { start: 5, end: 6 } });
		const close = tokenizeSpl('x)');
		expect(close).toMatchObject({ ok: false, error: { start: 1, end: 2 } });
	});

	it('reports an unknown character and an unknown escape with a position', () => {
		expect(tokenizeSpl('a # b')).toMatchObject({ ok: false, error: { start: 2, end: 3 } });
		expect(tokenizeSpl('"a\\qb"')).toMatchObject({ ok: false, error: { start: 2, end: 4 } });
		expect(tokenizeSpl('a ! b')).toMatchObject({ ok: false, error: { start: 2, end: 3 } });
	});
});

describe('parseSplStages', () => {
	it('splits on pipes outside strings and parens; whitespace and newlines are insignificant', () => {
		const r = parseSplStages('Authentication event\n  | where user="a|b"\n\n| stats count as n by x');
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.stages.map((s) => s.command)).toEqual(['root', 'where', 'stats']);
		expect(r.stages[1].args.map((a) => a.value)).toEqual(['user', '=', 'a|b']);
		expect(r.stages[2].args.map((a) => a.value)).toEqual(['count', 'as', 'n', 'by', 'x']);
	});

	it('gives each stage a span covering its text', () => {
		const text = 'Alert | where a=1';
		const r = parseSplStages(text);
		if (!r.ok) throw new Error('unexpected');
		expect(text.slice(r.stages[0].span.start, r.stages[0].span.end)).toBe('Alert');
		expect(text.slice(r.stages[1].span.start, r.stages[1].span.end)).toBe('where a=1');
	});

	it('lowercases the command and keeps the first stage as raw root tokens', () => {
		const r = parseSplStages('Log file (exact) | WHERE a=1');
		if (!r.ok) throw new Error('unexpected');
		expect(r.stages[0].args.map((a) => a.value)).toEqual(['Log', 'file', '(', 'exact', ')']);
		expect(r.stages[1].command).toBe('where');
	});

	it('does not split on a pipe inside a subsearch bracket', () => {
		const r = parseSplStages('Alert | where a IN [ search B | head 1 ]');
		if (!r.ok) throw new Error('unexpected');
		expect(r.stages).toHaveLength(2);
	});

	it('rejects empty input, an empty stage and a leading pipe', () => {
		expect(parseSplStages('   ')).toMatchObject({ ok: false });
		expect(parseSplStages('Alert |')).toMatchObject({ ok: false, error: { start: 6 } });
		expect(parseSplStages('Alert | | head 1')).toMatchObject({ ok: false });
		expect(parseSplStages('| where a=1')).toMatchObject({ ok: false });
	});

	it('propagates tokenizer errors', () => {
		expect(parseSplStages('Alert | where a="x')).toMatchObject({ ok: false, error: { start: 16 } });
	});
});
