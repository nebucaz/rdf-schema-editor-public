/**
 * SPL input (spec/spl-input): tokenizer, stage splitter and — in later stories — the resolver that turns
 * SPL text into a `QueryModel`. Pure: no Svelte, no DOM, no connector, no dependency.
 *
 * Guarantee (the printer ⇄ parser pair): `parse(print(m)) ≡ m` modulo ids, headers and namespaces, and
 * therefore `print(parse(print(m))) === print(m)`. Splunk-dialect synonyms are one-way: the printer
 * always emits the single canonical form. Nothing here throws — the only failure type is
 * `SplParseError`, which always carries the source span it refers to.
 */
import type { BuilderClass, BuilderSchema } from './query-builder-schema';
import { XSD_DATETIME } from './query-datatypes';
import {
	ALIAS_PATTERN,
	validateRunnableQueryModel,
	type Aggregation,
	type Column,
	type ColumnSource,
	type Filter,
	type FilterOp,
	type Having,
	type HavingOp,
	type Hop,
	type Measure,
	type MeasureFn,
	type QueryModel
} from './query-model';

export interface SplSpan {
	/** Offset of the first character (inclusive). */
	start: number;
	/** Offset after the last character (exclusive). */
	end: number;
}

export interface SplParseError extends SplSpan {
	message: string;
	/** Things that would have been accepted here, when that is a short closed list. */
	expected?: string[];
	/** Documentation topic for "not supported" constructs (STORY-218). */
	helpTopic?: string;
}

export type SplTokenType =
	| 'ident'
	| 'string'
	| 'number'
	| 'op'
	| 'lparen'
	| 'rparen'
	| 'lbracket'
	| 'rbracket'
	| 'comma'
	| 'minus';

export interface SplToken extends SplSpan {
	type: SplTokenType;
	/** Unescaped content for strings; the source text otherwise. */
	value: string;
	/** 1-based. */
	line: number;
	/** 1-based. */
	column: number;
}

export interface SplStage {
	/** The first token of a non-root stage (original case); `null` for the root stage. */
	head: SplToken | null;
	/** Lower-cased command word; the first stage is always `'root'` and keeps every token as `args`. */
	command: string;
	args: SplToken[];
	span: SplSpan;
}

export type TokenizeResult = { ok: true; tokens: SplToken[] } | { ok: false; error: SplParseError };
export type StagesResult = { ok: true; stages: SplStage[] } | { ok: false; error: SplParseError };

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' };
const OPERATORS = ['==', '!=', '<=', '>=', '=', '<', '>'];

const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isWordPart = (c: string) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';
const NUMBER = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/;

export function tokenizeSpl(text: string): TokenizeResult {
	const tokens: SplToken[] = [];
	const fail = (message: string, start: number, end: number): TokenizeResult => ({
		ok: false,
		error: { message, start, end }
	});
	// Line starts, so a token's line/column derive from its offset.
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
	const where = (offset: number) => {
		let lo = 0;
		let hi = lineStarts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (lineStarts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return { line: lo + 1, column: offset - lineStarts[lo] + 1 };
	};
	const push = (type: SplTokenType, value: string, start: number, end: number) =>
		tokens.push({ type, value, start, end, ...where(start) });

	const openers: { char: string; at: number }[] = [];
	const closing = { ')': '(', ']': '[' } as const;

	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		if (c === '"') {
			const start = i++;
			let value = '';
			let closed = false;
			while (i < text.length) {
				const ch = text[i];
				if (ch === '\\') {
					const next = text[i + 1];
					if (next === undefined || !(next in ESCAPES))
						return fail(`Unknown escape sequence \\${next ?? ''}`, i, Math.min(i + 2, text.length));
					value += ESCAPES[next];
					i += 2;
					continue;
				}
				if (ch === '"') {
					closed = true;
					i++;
					break;
				}
				value += ch;
				i++;
			}
			if (!closed) return fail('Unterminated string: missing closing quote', start, text.length);
			push('string', value, start, i);
			continue;
		}
		if (c === '(' || c === '[') {
			openers.push({ char: c, at: i });
			push(c === '(' ? 'lparen' : 'lbracket', c, i, i + 1);
			i++;
			continue;
		}
		if (c === ')' || c === ']') {
			const open = openers.pop();
			if (!open || open.char !== closing[c]) return fail(`Unexpected "${c}"`, i, i + 1);
			push(c === ')' ? 'rparen' : 'rbracket', c, i, i + 1);
			i++;
			continue;
		}
		if (c === ',') {
			push('comma', ',', i, i + 1);
			i++;
			continue;
		}
		const op = OPERATORS.find((o) => text.startsWith(o, i));
		if (op) {
			push('op', op, i, i + op.length);
			i += op.length;
			continue;
		}
		const signed = (c === '-' || c === '+') && (isDigit(text[i + 1] ?? '') || (text[i + 1] === '.' && isDigit(text[i + 2] ?? '')));
		if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? '')) || signed) {
			const m = NUMBER.exec(text.slice(i))!;
			let end = i + m[0].length;
			// A number glued to letters (`-24h`, `5xyz`) is a word, not a number.
			if (isWordStart(text[end] ?? '')) {
				while (end < text.length && (isWordPart(text[end]) || text[end] === '.')) end++;
				push('ident', text.slice(i, end), i, end);
			} else {
				push('number', m[0], i, end);
			}
			i = end;
			continue;
		}
		if (c === '-') {
			push('minus', '-', i, i + 1);
			i++;
			continue;
		}
		if (isWordStart(c) || (c === '^' && isWordStart(text[i + 1] ?? ''))) {
			let end = i + 1;
			// Dots join path segments (`a.b.c`); a dot must be followed by another word character. A
			// segment may be prefixed `^` (inverse hop): `^hostedOn.^recordedIn`.
			while (
				end < text.length &&
				(isWordPart(text[end]) ||
					(text[end] === '^' && text[end - 1] === '.' && isWordStart(text[end + 1] ?? '')) ||
					(text[end] === '.' &&
						(isWordPart(text[end + 1] ?? '') || (text[end + 1] === '^' && isWordStart(text[end + 2] ?? '')))))
			)
				end++;
			push('ident', text.slice(i, end), i, end);
			i = end;
			continue;
		}
		if (c === '|') {
			// Stage separators are handled by `parseSplStages`; the tokenizer surfaces them as their own type.
			push('op', '|', i, i + 1);
			i++;
			continue;
		}
		return fail(c === '!' ? 'Unexpected "!" (did you mean "!=")' : `Unexpected character "${c}"`, i, i + 1);
	}
	const open = openers[0];
	if (open) return fail(`Unterminated "${open.char}": missing closing "${open.char === '(' ? ')' : ']'}"`, open.at, open.at + 1);
	return { ok: true, tokens };
}

/** Splits tokenised input on `|` that is outside strings, parentheses and brackets. */
export function parseSplStages(text: string): StagesResult {
	if (text.trim() === '') {
		return { ok: false, error: { message: 'Enter a query: start with a class name', start: 0, end: 0 } };
	}
	const lexed = tokenizeSpl(text);
	if (!lexed.ok) return lexed;

	const groups: SplToken[][] = [[]];
	const pipes: SplToken[] = [];
	let depth = 0;
	for (const t of lexed.tokens) {
		if (t.type === 'lparen' || t.type === 'lbracket') depth++;
		else if (t.type === 'rparen' || t.type === 'rbracket') depth--;
		if (t.type === 'op' && t.value === '|' && depth === 0) {
			pipes.push(t);
			groups.push([]);
		} else {
			groups[groups.length - 1].push(t);
		}
	}

	const stages: SplStage[] = [];
	for (const [index, group] of groups.entries()) {
		if (group.length === 0) {
			if (index === 0)
				return { ok: false, error: { message: 'Start with a class name before the first "|"', start: pipes[0].start, end: pipes[0].end } };
			const pipe = pipes[index - 1];
			return { ok: false, error: { message: 'Empty stage: expected a command after "|"', start: pipe.start, end: pipe.end } };
		}
		const span = { start: group[0].start, end: group[group.length - 1].end };
		if (index === 0) {
			stages.push({ command: 'root', head: null, args: group, span });
			continue;
		}
		const [head, ...args] = group;
		if (head.type !== 'ident')
			return { ok: false, error: { message: 'Expected a command name after "|"', start: head.start, end: head.end } };
		stages.push({ command: head.value.toLowerCase(), head, args, span: { start: head.start, end: span.end } });
	}
	return { ok: true, stages };
}

// ── Resolver: SPL text → QueryModel ─────────────────────────────────────────

export type SplParseResult = { ok: true; model: QueryModel } | { ok: false; error: SplParseError };

export interface SplParseOptions {
	/** Instance-graph namespaces in scope (the workbench selection); the text never carries them. */
	namespaces: string[];
}

/** Internal control flow only: `parseSpl` catches it, so nothing escapes as an exception. */
class SplFailure {
	constructor(readonly error: SplParseError) {}
}
const unsupported = (construct: string, at: SplSpan): never => {
	throw new SplFailure({
		message: `${construct} is not supported in this workbench`,
		start: at.start,
		end: at.end,
		helpTopic: 'spl-unsupported'
	});
};
const fail = (message: string, at: SplSpan, expected?: string[]): never => {
	throw new SplFailure({ message, start: at.start, end: at.end, ...(expected && expected.length ? { expected } : {}) });
};

function editDistance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cur = row[j];
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
			prev = cur;
		}
	}
	return row[b.length];
}

/** Up to five candidates close to `input`: prefix/substring matches first, then small edit distance. */
export function suggestLabels(input: string, candidates: readonly string[]): string[] {
	const q = input.toLowerCase();
	const scored: { c: string; score: number }[] = [];
	for (const c of new Set(candidates)) {
		const l = c.toLowerCase();
		let score = Infinity;
		if (l === q) score = 0;
		else if (l.startsWith(q) || q.startsWith(l)) score = 1;
		else if (l.includes(q) || q.includes(l)) score = 2;
		else {
			const d = editDistance(l, q);
			if (d <= Math.max(2, Math.floor(Math.max(l.length, q.length) / 3))) score = 3 + d;
		}
		if (score !== Infinity) scored.push({ c, score });
	}
	return scored.sort((a, b) => a.score - b.score || a.c.localeCompare(b.c)).slice(0, 5).map((x) => x.c);
}

type Member =
	| { kind: 'property'; iri: string; label: string; owner: BuilderClass; datatype: string; allowed: { value: string; label: string }[] }
	| { kind: 'relationship'; iri: string; label: string; owner: BuilderClass; targetClassIri: string };

const COMMANDS = new Set(['where', 'stats', 'fields', 'sort', 'head']);
/** Accepted spellings that map onto a canonical command. */
const COMMAND_SYNONYMS: Record<string, string> = { table: 'fields' };
const EXTRA_COMMANDS = new Set(['rename', 'top']);
/** Splunk commands with no model equivalent: always a positioned "not supported" error. */
const UNSUPPORTED_COMMANDS = new Set([
	'eval', 'rex', 'regex', 'join', 'append', 'appendcols', 'lookup', 'inputlookup', 'outputlookup', 'transaction',
	'timechart', 'chart', 'eventstats', 'streamstats', 'bin', 'bucket', 'spath', 'makeresults', 'fillnull',
	'mvexpand', 'dedup', 'tail', 'format', 'map', 'union'
]);
const RELATIVE_TIME = /^(now|[+-]\d+\s*[a-z]+(@[a-z0-9]+)?|@[a-z0-9]+)$/i;
const MEASURE_FN: Record<string, MeasureFn> = {
	count: 'count',
	dc: 'countDistinct',
	sum: 'sum',
	avg: 'avg',
	min: 'min',
	max: 'max'
};
const FILTER_SYMBOL: Record<string, FilterOp> = { '=': 'eq', '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
const HAVING_SYMBOL: Record<string, HavingOp> = { '=': 'eq', '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

interface FieldRef {
	hopId: string | null;
	/** Resolved leaf: a schema member, or the reserved `label`/`iri`. */
	leaf: Member | 'label' | 'iri';
	/** Class whose members the leaf was looked up on. */
	classIri: string;
	span: SplSpan;
}

class Resolver {
	private readonly classByLabel = new Map<string, BuilderClass[]>();
	private readonly hops: Hop[] = [];
	private readonly hopByKey = new Map<string, Hop>();
	private readonly hopSpans: SplSpan[] = [];
	private readonly filters: Filter[] = [];
	private readonly filterSpans: { whole: SplSpan; value: SplSpan }[] = [];
	private readonly columns: Column[] = [];
	private readonly columnSpans: SplSpan[] = [];
	private rootClass!: BuilderClass;
	private includeSubclasses = true;

	constructor(
		private readonly text: string,
		private readonly schema: BuilderSchema,
		private readonly opts: SplParseOptions
	) {
		for (const c of schema.classes.values()) {
			const key = c.label.toLowerCase();
			this.classByLabel.set(key, [...(this.classByLabel.get(key) ?? []), c]);
		}
	}

	// ── schema lookups ──

	private scope(classIri: string): BuilderClass[] {
		const c = this.schema.classes.get(classIri);
		if (!c) return [];
		return [c, ...c.subclasses.map((s) => this.schema.classes.get(s)).filter((x): x is BuilderClass => x !== undefined)];
	}

	private membersOf(classIri: string): Member[] {
		const out: Member[] = [];
		const seen = new Set<string>();
		for (const owner of this.scope(classIri)) {
			for (const p of owner.properties) {
				const key = `p\u0000${p.iri}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({
					kind: 'property',
					iri: p.iri,
					label: p.label,
					owner,
					datatype: p.datatype,
					allowed: (p.allowedValues ?? []).map((v) => ({ value: v.value, label: v.label }))
				});
			}
			for (const r of owner.relationships) {
				const key = `r\u0000${r.iri}\u0000${r.targetClassIri}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({ kind: 'relationship', iri: r.iri, label: r.label, owner, targetClassIri: r.targetClassIri });
			}
		}
		return out;
	}

	/** Relationships that point *at* `classIri` (or a subclass of it): the targets of an inverse hop. */
	private inboundMembers(classIri: string): Extract<Member, { kind: 'relationship' }>[] {
		const out: Extract<Member, { kind: 'relationship' }>[] = [];
		const seen = new Set<string>();
		for (const owner of this.scope(classIri)) {
			for (const r of owner.inboundRelationships) {
				const key = `${r.iri}\u0000${r.sourceClassIri}`;
				if (seen.has(key)) continue;
				seen.add(key);
				const source = this.schema.classes.get(r.sourceClassIri);
				if (!source) continue;
				out.push({ kind: 'relationship', iri: r.iri, label: r.label, owner: source, targetClassIri: r.sourceClassIri });
			}
		}
		return out;
	}

	/** Resolves one path segment (`label` or `^label`) to a relationship leaving or entering `classIri`. */
	private pickRelationship(
		seg: { text: string; start: number; end: number },
		classIri: string
	): { m: Extract<Member, { kind: 'relationship' }>; direction: Hop['direction'] } {
		const inverse = seg.text.startsWith('^');
		const label = inverse ? seg.text.slice(1) : seg.text;
		const pool = inverse
			? this.inboundMembers(classIri)
			: this.membersOf(classIri).filter((x): x is Extract<Member, { kind: 'relationship' }> => x.kind === 'relationship');
		const m = this.pick(label, seg, pool, inverse ? 'inbound relationship' : 'relationship', this.classLabel(classIri)) as Extract<
			Member,
			{ kind: 'relationship' }
		>;
		return { m, direction: inverse ? 'inverse' : 'forward' };
	}

	private classLabel(iri: string): string {
		return this.schema.classes.get(iri)?.label ?? iri;
	}

	/** Exact-case match wins; otherwise case-insensitive. Several candidates are an error, never a guess. */
	private pick(label: string, span: SplSpan, pool: Member[], what: string, owner: string): Member {
		const lower = label.toLowerCase();
		const exact = pool.filter((m) => m.label === label);
		const found = exact.length > 0 ? exact : pool.filter((m) => m.label.toLowerCase() === lower);
		if (found.length === 1) return found[0];
		if (found.length > 1) {
			return fail(
				`Ambiguous ${what} "${label}": it could be ${found.map((m) => `${m.owner.label}.${m.label}`).join(', ')}`,
				span,
				found.map((m) => `${m.owner.label}.${m.label}`)
			);
		}
		return fail(
			`Unknown ${what} "${label}" on ${owner}`,
			span,
			suggestLabels(label, pool.map((m) => m.label))
		);
	}

	// ── root ──

	resolveRoot(stage: SplStage): void {
		let tokens = stage.args;
		const times: { which: 'earliest' | 'latest'; value: SplToken; at: SplToken }[] = [];
		// Trailing `(exact)` and `earliest=… / latest=…` pairs, in either order.
		for (let again = true; again; ) {
			again = false;
			const n = tokens.length;
			if (
				n >= 4 &&
				tokens[n - 3].type === 'lparen' &&
				tokens[n - 2].type === 'ident' &&
				tokens[n - 2].value.toLowerCase() === 'exact' &&
				tokens[n - 1].type === 'rparen'
			) {
				this.includeSubclasses = false;
				tokens = tokens.slice(0, n - 3);
				again = true;
			} else if (
				n >= 4 &&
				tokens[n - 2].type === 'op' &&
				(tokens[n - 2].value === '=' || tokens[n - 2].value === '==') &&
				tokens[n - 3].type === 'ident' &&
				['earliest', 'latest'].includes(tokens[n - 3].value.toLowerCase())
			) {
				times.unshift({
					which: tokens[n - 3].value.toLowerCase() as 'earliest' | 'latest',
					value: tokens[n - 1],
					at: tokens[n - 3]
				});
				tokens = tokens.slice(0, n - 3);
				again = true;
			}
		}
		if (tokens.length === 0) fail('Start with a class name', stage.span);
		const tryLabel = (from: number): BuilderClass | null => {
			const span = { start: tokens[from].start, end: tokens[tokens.length - 1].end };
			const label = this.text.slice(span.start, span.end);
			const found = this.classByLabel.get(label.toLowerCase()) ?? [];
			if (found.length === 1) return found[0];
			if (found.length > 1) {
				return fail(
					`Ambiguous class "${label}": it could be ${found.map((c) => c.iri).join(', ')}`,
					span,
					found.map((c) => c.iri)
				);
			}
			return null;
		};
		let from = 0;
		let found = tryLabel(0);
		// `search <Class>`: the whole text is tried as a label first, so a class named "Search …" still works.
		if (!found && tokens.length > 1 && tokens[0].type === 'ident' && tokens[0].value.toLowerCase() === 'search') {
			from = 1;
			found = tryLabel(1);
		}
		if (!found) {
			const span = { start: tokens[from].start, end: tokens[tokens.length - 1].end };
			const label = this.text.slice(span.start, span.end);
			return fail(
				`Unknown class "${label}"`,
				span,
				suggestLabels(label, [...this.schema.classes.values()].map((c) => c.label))
			);
		}
		this.rootClass = found;
		for (const t of times) this.addTimeFilter(t.which, t.value, t.at);
	}

	/** `earliest` → `gte`, `latest` → `lt` on the root class's single `xsd:dateTime` property. */
	private addTimeFilter(which: 'earliest' | 'latest', value: SplToken, at: SplSpan): void {
		if (value.type === 'ident' || (value.type === 'string' && RELATIVE_TIME.test(value.value.trim()))) {
			throw new SplFailure({
				message: 'relative time is not supported yet: use an absolute timestamp such as "2026-01-01T00:00:00Z"',
				start: value.start,
				end: value.end,
				helpTopic: 'spl-relative-time'
			});
		}
		if (value.type !== 'string') return fail(`${which} needs a quoted timestamp`, value);
		const times = this.membersOf(this.rootClass.iri).filter(
			(m): m is Extract<Member, { kind: 'property' }> => m.kind === 'property' && m.datatype === XSD_DATETIME
		);
		if (times.length !== 1) {
			return fail(
				times.length === 0
					? `${which} needs a dateTime property, but ${this.rootClass.label} has none`
					: `${which} is ambiguous: ${this.rootClass.label} has several dateTime properties (${times.map((t) => t.label).join(', ')}); filter one of them with >= and <`,
				at,
				times.map((t) => t.label)
			);
		}
		this.filters.push({
			id: `f${this.filters.length + 1}`,
			hopId: null,
			propertyIri: times[0].iri,
			op: which === 'earliest' ? 'gte' : 'lt',
			value: value.value
		});
		this.filterSpans.push({ whole: { start: at.start, end: value.end }, value });
	}

	// ── hops and fields ──

	private segments(token: SplToken): { text: string; start: number; end: number }[] {
		const out: { text: string; start: number; end: number }[] = [];
		let at = token.start;
		for (const part of token.value.split('.')) {
			out.push({ text: part, start: at, end: at + part.length });
			at += part.length + 1;
		}
		return out;
	}

	/** Walks the leading segments of a dotted path through the hops that already exist. */
	private walk(segs: { text: string; start: number; end: number }[], count: number): { hop: Hop | null; classIri: string } {
		let classIri = this.rootClass.iri;
		let hop: Hop | null = null;
		let key = '';
		for (let i = 0; i < count; i++) {
			const { m, direction } = this.pickRelationship(segs[i], classIri);
			key += `>${direction === 'inverse' ? '^' : ''}${m.iri}\u0000${m.targetClassIri}`;
			const existing = this.hopByKey.get(key);
			if (!existing) {
				const path = segs.slice(0, i + 1).map((s) => s.text).join('.');
				fail(`"${path}" is not expanded yet: add a "| ${path}" stage first`, segs[i]);
			}
			hop = existing!;
			classIri = hop.targetClassIri;
		}
		return { hop, classIri };
	}

	resolveHop(stage: SplStage): void {
		const head = stage.head!;
		if (stage.args.length > 0)
			fail(`Unknown command "${head.value}"`, head, [...COMMANDS]);
		const segs = this.segments(head);
		const last = segs.length - 1;
		const { hop: parent, classIri } = this.walk(segs, last);
		const { m, direction } = this.pickRelationship(segs[last], classIri);
		// Key mirrors `walk`: the chain of (direction, relationship, target) triples from the root.
		let key = '';
		for (let p = parent; p !== null; p = p.parentHopId === null ? null : this.hops.find((h) => h.id === p!.parentHopId) ?? null) {
			key = `>${p.direction === 'inverse' ? '^' : ''}${p.propertyIri}\u0000${p.targetClassIri}${key}`;
		}
		key += `>${direction === 'inverse' ? '^' : ''}${m.iri}\u0000${m.targetClassIri}`;
		if (this.hopByKey.has(key)) fail(`"${head.value}" is already expanded`, head);
		const hop: Hop = {
			id: `h${this.hops.length + 1}`,
			parentHopId: parent?.id ?? null,
			propertyIri: m.iri,
			direction,
			targetClassIri: m.targetClassIri
		};
		this.hops.push(hop);
		this.hopSpans.push({ start: head.start, end: head.end });
		this.hopByKey.set(key, hop);
	}

	/** Resolves `a.b.leaf` (hops by label, then a property/relationship, `label` or `iri`). */
	resolveField(token: SplToken): FieldRef {
		if (token.type !== 'ident') fail('Expected a field name', token);
		const segs = this.segments(token);
		const last = segs.length - 1;
		const { hop, classIri } = this.walk(segs, last);
		const leafSeg = segs[last];
		const lower = leafSeg.text.toLowerCase();
		const pool = this.membersOf(classIri);
		const hasMember = pool.some((m) => m.label.toLowerCase() === lower);
		if (!hasMember && (lower === 'label' || lower === 'iri')) {
			return { hopId: hop?.id ?? null, leaf: lower, classIri, span: { start: token.start, end: token.end } };
		}
		const m = this.pick(leafSeg.text, leafSeg, pool, 'field', this.classLabel(classIri));
		return { hopId: hop?.id ?? null, leaf: m, classIri, span: { start: token.start, end: token.end } };
	}

	// ── filters ──

	private membersWithLabel(classIri: string): { value: string; label: string }[] {
		return this.scope(classIri).flatMap((c) => c.members.map((m) => ({ value: m.value, label: m.label })));
	}

	/** Maps the text of a quoted value back to the stored value (member IRI, `sh:in` value, or literal). */
	private resolveValue(token: SplToken, field: FieldRef): string {
		if (token.type !== 'string' && token.type !== 'number')
			return fail('Expected a quoted value', token);
		const text = token.value;
		let pool: { value: string; label: string }[] | null = null;
		let strict = false;
		if (field.leaf === 'iri' || field.leaf === 'label') {
			pool = this.membersWithLabel(field.classIri);
		} else if (field.leaf.kind === 'relationship') {
			pool = this.membersWithLabel(field.leaf.targetClassIri);
		} else if (field.leaf.allowed.length > 0) {
			pool = field.leaf.allowed;
			strict = true;
		}
		if (pool === null) return text;
		const byLabel = pool.filter((p) => p.label === text);
		const found = byLabel.length > 0 ? byLabel : pool.filter((p) => p.label.toLowerCase() === text.toLowerCase());
		const distinct = [...new Set(found.map((f) => f.value))];
		if (distinct.length === 1) return distinct[0];
		if (distinct.length > 1)
			return fail(`Ambiguous value ${JSON.stringify(text)}: it could be ${distinct.join(', ')}`, token, distinct);
		if (pool.some((p) => p.value === text)) return text;
		if (!strict && ABSOLUTE_IRI.test(text)) return text;
		return fail(
			`Unknown value ${JSON.stringify(text)}`,
			token,
			suggestLabels(text, pool.map((p) => p.label))
		);
	}

	private valueList(tokens: SplToken[], from: number, field: FieldRef): { values: string[]; next: number } {
		if (tokens[from]?.type !== 'lparen') return fail('Expected "(" after IN', tokens[from] ?? tokens[from - 1]);
		const values: string[] = [];
		let i = from + 1;
		for (;;) {
			const t = tokens[i];
			if (!t) return fail('Expected a value', tokens[from]);
			values.push(this.resolveValue(t, field));
			i++;
			if (tokens[i]?.type === 'comma') {
				i++;
				continue;
			}
			if (tokens[i]?.type === 'rparen') return { values, next: i + 1 };
			return fail('Expected "," or ")"', tokens[i] ?? t);
		}
	}

	private expectEnd(tokens: SplToken[], at: number): void {
		if (at < tokens.length) fail(`Unexpected "${tokens[at].value}"`, tokens[at]);
	}

	/** Splits a `where` on top-level `AND`; `OR`/`NOT` have no model equivalent (yet). */
	conditions(stage: SplStage): SplStage[] {
		const parts: SplToken[][] = [[]];
		let depth = 0;
		for (const tok of stage.args) {
			if (tok.type === 'lparen') depth++;
			else if (tok.type === 'rparen') depth--;
			if (tok.type === 'ident' && depth === 0) {
				const word = tok.value.toLowerCase();
				if (word === 'or' || word === 'not') unsupported(tok.value.toUpperCase(), tok);
				if (word === 'and') {
					if (parts[parts.length - 1].length === 0) fail('Expected a condition before AND', tok);
					parts.push([]);
					continue;
				}
			}
			parts[parts.length - 1].push(tok);
		}
		if (parts[parts.length - 1].length === 0) {
			fail('Expected a condition after "where"' + (parts.length > 1 ? ' AND' : ''), stage.args[stage.args.length - 1] ?? stage.head!);
		}
		return parts.map((args) => ({
			...stage,
			args,
			span: { start: args[0].start, end: args[args.length - 1].end }
		}));
	}

	/** One `where` condition over entity fields. */
	addFilter(stage: SplStage): void {
		const t = stage.args;
		if (t.length === 0) fail('Expected a condition after "where"', stage.head!);
		const word = t[0].type === 'ident' ? t[0].value.toLowerCase() : '';
		if (
			(word === 'earliest' || word === 'latest') &&
			t.length === 3 &&
			t[1].type === 'op' &&
			(t[1].value === '=' || t[1].value === '==') &&
			!this.membersOf(this.rootClass.iri).some((m) => m.label.toLowerCase() === word)
		) {
			this.addTimeFilter(word, t[2], t[0]);
			return;
		}
		const whole = { start: t[0].start, end: t[t.length - 1].end };
		const first = t[0];
		let filter: Omit<Filter, 'id'>;
		let valueSpan: SplSpan = whole;

		const fn = first.type === 'ident' ? first.value.toLowerCase() : '';
		if (t[1]?.type === 'lparen' && (fn === 'like' || fn === 'isnull' || fn === 'isnotnull')) {
			if (!t[2]) return fail(`Expected a field inside ${fn}(…)`, t[1]);
			const field = this.resolveField(t[2]);
			let i = 3;
			if (fn === 'like') {
				if (t[i]?.type !== 'comma') return fail('Expected "," then a pattern', t[i] ?? t[2]);
				const pat = t[i + 1];
				if (!pat || pat.type !== 'string') return fail('Expected a quoted pattern', pat ?? t[i]);
				const m = /^%(.*)%$/s.exec(pat.value);
				if (!m || m[1].includes('%') || m[1] === '')
					return fail('only contains-style patterns are supported: use like(field, "%value%")', pat);
				valueSpan = pat;
				i += 2;
				filter = { hopId: field.hopId, propertyIri: this.propertyIriOf(field, 'like'), op: 'contains', value: m[1] };
			} else {
				filter = {
					hopId: field.hopId,
					propertyIri: this.propertyIriOf(field, fn),
					op: fn === 'isnull' ? 'isEmpty' : 'isNotEmpty'
				};
			}
			if (t[i]?.type !== 'rparen') return fail('Expected ")"', t[i] ?? t[i - 1]);
			this.expectEnd(t, i + 1);
		} else {
			const field = this.resolveField(first);
			const opTok = t[1];
			if (!opTok) return fail('Expected a comparison operator after the field', first);
			if (opTok.type === 'ident' && opTok.value.toLowerCase() === 'in') {
				const { values, next } = this.valueList(t, 2, field);
				this.expectEnd(t, next);
				valueSpan = { start: t[2].start, end: t[next - 1].end };
				filter = { hopId: field.hopId, propertyIri: this.propertyIriOf(field, 'IN'), op: 'in', value: values };
			} else {
				const op = opTok.type === 'op' ? FILTER_SYMBOL[opTok.value] : undefined;
				if (!op) return fail('Expected a comparison operator (=, !=, <, <=, >, >=) or IN', opTok);
				const valueTok = t[2];
				if (!valueTok) return fail(`Expected a value after "${opTok.value}"`, opTok);
				this.expectEnd(t, 3);
				valueSpan = valueTok;
				if (op === 'eq' || op === 'neq') {
					filter = { hopId: field.hopId, propertyIri: this.propertyIriOf(field, opTok.value), op, value: this.resolveValue(valueTok, field) };
				} else {
					if (valueTok.type !== 'string' && valueTok.type !== 'number')
						return fail('Expected a number or a quoted value', valueTok);
					filter = { hopId: field.hopId, propertyIri: this.propertyIriOf(field, opTok.value), op, value: valueTok.value };
				}
			}
		}
		this.filters.push({ id: `f${this.filters.length + 1}`, ...filter });
		this.filterSpans.push({ whole, value: valueSpan });
	}

	/** `null` = the entity itself (`iri`); `label` is not filterable. */
	private propertyIriOf(field: FieldRef, what: string): string | null {
		if (field.leaf === 'iri') return null;
		if (field.leaf === 'label') return fail(`"${what}" on label is not supported: filter on iri or a property`, field.span);
		return field.leaf.iri;
	}

	// ── columns ──

	private columnFor(field: FieldRef, taken: ReadonlySet<string> = new Set()): Column {
		const source: ColumnSource =
			field.leaf === 'label' || field.leaf === 'iri' ? field.leaf : { propertyIri: field.leaf.iri };
		const existing = this.columns.find(
			(c) =>
				c.hopId === field.hopId &&
				(typeof c.source === 'string' || typeof source === 'string'
					? c.source === source
					: c.source.propertyIri === source.propertyIri)
		);
		if (existing) return existing;
		let n = this.columns.length + 1;
		while (taken.has(`c${n}`) || this.columns.some((c) => c.id === `c${n}`)) n++;
		const entityClass = this.classLabel(field.classIri);
		const header =
			source === 'label' ? entityClass : source === 'iri' ? `${entityClass} IRI` : (field.leaf as Member).label;
		const column: Column = { id: `c${n}`, hopId: field.hopId, source, header };
		this.columns.push(column);
		this.columnSpans.push(field.span);
		return column;
	}

	private fieldList(tokens: SplToken[], what: string, taken?: ReadonlySet<string>): { cols: Column[]; consumed: number } {
		const cols: Column[] = [];
		let i = 0;
		for (;;) {
			const t = tokens[i];
			if (!t) return fail(`Expected a field in ${what}`, tokens[i - 1] ?? tokens[0]);
			cols.push(this.columnFor(this.resolveField(t), taken));
			i++;
			if (tokens[i]?.type === 'comma') {
				i++;
				continue;
			}
			return { cols, consumed: i };
		}
	}

	setFields(stage: SplStage): void {
		if (stage.args.length === 0) fail('Expected one or more fields after "fields"', stage.head!);
		if (stage.args[0].type === 'minus') unsupported('fields - <field> (removing fields)', stage.args[0]);
		const { consumed } = this.fieldList(stage.args, 'fields');
		this.expectEnd(stage.args, consumed);
	}

	// ── stats / having ──

	aggregation: Aggregation | undefined;
	private measureSpans: SplSpan[] = [];
	private havingSpans: SplSpan[] = [];
	private groupBySpans: SplSpan[] = [];

	setStats(stage: SplStage): void {
		const t = stage.args;
		type Pending = { fn: MeasureFn; target: FieldRef | 'root'; alias: string; span: SplSpan };
		const pending: Pending[] = [];
		const rootLabel = this.rootClass.label;
		let i = 0;
		while (i < t.length && !(t[i].type === 'ident' && t[i].value.toLowerCase() === 'by')) {
			const fnTok = t[i];
			const fn = fnTok.type === 'ident' ? MEASURE_FN[fnTok.value.toLowerCase()] : undefined;
			if (!fn) return fail(`Unknown measure "${fnTok.value}"`, fnTok, Object.keys(MEASURE_FN));
			i++;
			let target: FieldRef | 'root' = 'root';
			if (t[i]?.type === 'lparen') {
				let close = i + 1;
				while (close < t.length && t[close].type !== 'rparen') close++;
				if (close >= t.length) return fail('Expected ")"', t[i]);
				const inner = t.slice(i + 1, close);
				if (inner.length === 0) return fail(`Expected a field inside ${fnTok.value}(…)`, t[i]);
				const innerSpan = { start: inner[0].start, end: inner[inner.length - 1].end };
				const innerText = this.text.slice(innerSpan.start, innerSpan.end);
				if (inner.length === 1 && inner[0].type === 'ident') {
					try {
						target = this.resolveField(inner[0]);
					} catch (e) {
						if (e instanceof SplFailure && innerText.toLowerCase() === rootLabel.toLowerCase()) target = 'root';
						else throw e;
					}
				} else if (innerText.toLowerCase() === rootLabel.toLowerCase()) {
					target = 'root';
				} else {
					return fail('Expected a field', innerSpan);
				}
				i = close + 1;
			} else if (fn !== 'count') {
				return fail(`${fnTok.value} needs a field in parentheses, e.g. ${fnTok.value}(field)`, fnTok);
			}
			if (t[i]?.type === 'ident' && t[i].value.toLowerCase() === 'as') {
				const aliasTok = t[i + 1];
				if (!aliasTok || aliasTok.type !== 'ident' || !ALIAS_PATTERN.test(aliasTok.value))
					return fail('Expected an alias (letters, digits and _)', aliasTok ?? t[i]);
				pending.push({ fn, target, alias: aliasTok.value, span: { start: fnTok.start, end: aliasTok.end } });
				i += 2;
			} else {
				// Splunk names an unaliased measure after itself; use a plain-identifier equivalent.
				const leaf = target === 'root' ? 'root' : typeof target.leaf === 'string' ? target.leaf : target.leaf.label;
				const base = fn === 'count' && target === 'root' ? 'count' : `${fnTok.value.toLowerCase()}_${leaf.replace(/[^A-Za-z0-9_]/g, '_')}`;
				let alias = ALIAS_PATTERN.test(base) ? base : `m_${pending.length + 1}`;
				for (let n = 2; pending.some((p) => p.alias === alias); n++) alias = `${base}_${n}`;
				pending.push({ fn, target, alias, span: { start: fnTok.start, end: t[i - 1].end } });
			}
			if (t[i]?.type === 'comma') i++;
			else break;
		}

		const taken = new Set(pending.map((p) => p.alias));
		const groupBy: string[] = [];
		if (t[i]?.type === 'ident' && t[i].value.toLowerCase() === 'by') {
			const by = t.slice(i + 1);
			if (by.length === 0) return fail('Expected one or more fields after "by"', t[i]);
			const { cols, consumed } = this.fieldList(by, 'by', taken);
			groupBy.push(...cols.map((c) => c.id));
			this.groupBySpans = cols.map((_, k) => ({ start: by[k * 2].start, end: by[k * 2].end }));
			i += 1 + consumed;
		}
		this.expectEnd(t, i);
		if (pending.length === 0 && groupBy.length === 0) fail('Expected a measure or "by" fields after "stats"', stage.head!);

		const measures: Measure[] = pending.map((p) => ({
			fn: p.fn,
			of: p.target === 'root' ? 'root' : this.columnFor(p.target, taken).id,
			alias: p.alias
		}));
		this.measureSpans = pending.map((p) => p.span);
		this.aggregation = { groupBy, measures };
	}

	addHaving(stage: SplStage): void {
		const t = stage.args;
		const agg = this.aggregation!;
		if (t.length === 0) fail('Expected a condition after "where"', stage.head!);
		const [name, opTok, valueTok] = t;
		if (name.type !== 'ident' || !agg.measures.some((m) => m.alias === name.value)) {
			return fail(
				`Unknown measure "${name.value}": a condition after stats must compare a measure alias`,
				name,
				agg.measures.map((m) => m.alias)
			);
		}
		const op = opTok?.type === 'op' ? HAVING_SYMBOL[opTok.value] : undefined;
		if (!op) return fail('Expected a comparison operator (=, !=, <, <=, >, >=)', opTok ?? name);
		if (!valueTok || valueTok.type !== 'number') return fail('Expected a number', valueTok ?? opTok);
		this.expectEnd(t, 3);
		const having: Having = { measure: name.value, op, value: Number(valueTok.value) };
		agg.having = [...(agg.having ?? []), having];
		this.havingSpans.push({ start: t[0].start, end: valueTok.end });
	}

	private fieldResolves(token: SplToken): boolean {
		try {
			this.resolveField(token);
			return true;
		} catch (e) {
			if (e instanceof SplFailure) return false;
			throw e;
		}
	}

	// ── rename / top ──

	renameFields(stage: SplStage): void {
		const t = stage.args;
		if (this.columns.length === 0 && !this.aggregation)
			fail('"rename" must come after "fields" or "stats"', stage.head!);
		if (t.length === 0) fail('Expected "<field> as <name>" after "rename"', stage.head!);
		let i = 0;
		for (;;) {
			const from = t[i];
			if (!from || from.type !== 'ident') return fail('Expected a field to rename', from ?? stage.head!);
			if (!(t[i + 1]?.type === 'ident' && t[i + 1].value.toLowerCase() === 'as'))
				return fail('Expected "as" after the field', t[i + 1] ?? from);
			const to = t[i + 2];
			if (!to || (to.type !== 'ident' && to.type !== 'string')) return fail('Expected a new name', to ?? t[i + 1]);
			const measure = this.aggregation?.measures.find((m) => m.alias === from.value);
			if (measure) {
				const taken = [
					...this.aggregation!.measures.map((m) => m.alias),
					...this.columns.map((c) => c.id)
				];
				if (!ALIAS_PATTERN.test(to.value))
					return fail('A measure name may only contain letters, digits and _', to);
				if (taken.includes(to.value) && to.value !== measure.alias) return fail(`Name "${to.value}" is already in use`, to);
				for (const h of this.aggregation!.having ?? []) if (h.measure === measure.alias) h.measure = to.value;
				for (const s of this.sort) if (s.columnId === measure.alias) s.columnId = to.value;
				measure.alias = to.value;
			} else {
				const field = this.resolveField(from);
				const column = this.columns.find(
					(c) =>
						c.hopId === field.hopId &&
						(typeof c.source === 'string'
							? c.source === field.leaf
							: typeof field.leaf !== 'string' && c.source.propertyIri === field.leaf.iri)
				);
				if (!column) return fail(`Cannot rename "${from.value}": it is not one of the shown fields`, from);
				column.header = to.value;
			}
			i += 3;
			if (t[i]?.type === 'comma') {
				i++;
				continue;
			}
			break;
		}
		this.expectEnd(t, i);
	}

	/** `top [N | limit=N] f1[, f2]` ≡ `stats count as count by f… | sort -count | head N`. */
	setTop(stage: SplStage): void {
		const t = stage.args;
		let i = 0;
		let limit = 10;
		if (t[0]?.type === 'number') {
			limit = this.wholeNumber(t[0]);
			i = 1;
		} else if (t[0]?.type === 'ident' && t[0].value.toLowerCase() === 'limit' && t[1]?.type === 'op' && t[1].value === '=') {
			if (!t[2] || t[2].type !== 'number') return fail('limit needs a whole number', t[2] ?? t[1]);
			limit = this.wholeNumber(t[2]);
			i = 3;
		}
		const rest = t.slice(i);
		if (rest.length === 0) fail('Expected one or more fields after "top"', stage.head!);
		const { cols, consumed } = this.fieldList(rest, 'top', new Set(['count']));
		this.expectEnd(rest, consumed);
		this.groupBySpans = cols.map((_, k) => ({ start: rest[k * 2].start, end: rest[k * 2].end }));
		this.aggregation = {
			groupBy: cols.map((c) => c.id),
			measures: [{ fn: 'count', of: 'root', alias: 'count' }]
		};
		this.measureSpans = [{ start: stage.head!.start, end: stage.span.end }];
		this.sort = [{ columnId: 'count', direction: 'desc' }];
		this.sortSpans = [{ start: stage.head!.start, end: stage.span.end }];
		this.limit = limit;
		this.limitSpan = t[i - 1] ?? stage.head!;
	}

	private wholeNumber(token: SplToken): number {
		if (!/^\d+$/.test(token.value)) return fail('Expected a whole number', token);
		return Number(token.value);
	}

	// ── sort / head ──

	sort: QueryModel['sort'] = [];
	private sortSpans: SplSpan[] = [];
	limit: number | undefined;
	private limitSpan: SplSpan = { start: 0, end: 0 };

	setSort(stage: SplStage): void {
		const t = stage.args;
		if (t.length === 0) fail('Expected one or more sort keys after "sort"', stage.head!);
		let i = 0;
		for (;;) {
			let direction: 'asc' | 'desc' = 'asc';
			const startTok = t[i];
			if (startTok?.type === 'minus') {
				direction = 'desc';
				i++;
			}
			const key = t[i];
			if (!key || key.type !== 'ident') return fail('Expected a field or measure to sort by', key ?? startTok);
			const alias = this.aggregation?.measures.find((m) => m.alias === key.value);
			let columnId: string;
			if (alias) {
				columnId = alias.alias;
			} else if (!key.value.includes('.') && this.columns.some((c) => c.header === key.value) && !this.fieldResolves(key)) {
				columnId = this.columns.find((c) => c.header === key.value)!.id;
			} else {
				const field = this.resolveField(key);
				const column = this.columns.find(
					(c) =>
						c.hopId === field.hopId &&
						(typeof c.source === 'string'
							? c.source === field.leaf
							: typeof field.leaf !== 'string' && c.source.propertyIri === field.leaf.iri)
				);
				if (!column) {
					return fail(
						`Cannot sort by "${key.value}": it is not one of the ${this.aggregation ? 'grouped' : 'shown'} fields`,
						key
					);
				}
				columnId = column.id;
			}
			this.sort.push({ columnId, direction });
			this.sortSpans.push({ start: startTok.start, end: key.end });
			i++;
			if (t[i]?.type === 'comma') {
				i++;
				continue;
			}
			break;
		}
		this.expectEnd(t, i);
	}

	setHead(stage: SplStage): void {
		const t = stage.args;
		if (t.length === 0 || t[0].type !== 'number' || !/^\d+$/.test(t[0].value))
			return fail('head needs a whole number, e.g. head 10', t[0] ?? stage.head!);
		this.expectEnd(t, 1);
		this.limit = Number(t[0].value);
		this.limitSpan = t[0];
	}

	// ── assembly ──

	build(): QueryModel {
		const model: QueryModel = {
			version: 1,
			root: { classIri: this.rootClass.iri, includeSubclasses: this.includeSubclasses },
			hops: this.hops,
			filters: this.filters,
			columns: this.columns,
			sort: this.sort,
			namespaces: [...this.opts.namespaces],
			...(this.aggregation ? { aggregation: this.aggregation } : {}),
			...(this.limit !== undefined ? { limit: this.limit } : {})
		};
		const issues = validateRunnableQueryModel(model, new Set(this.schema.classes.keys()), this.schema);
		if (issues.length > 0) {
			const issue = issues[0];
			const { span, message } = this.explain(issue.path, issue.message);
			fail(message, span);
		}
		return model;
	}

	/** Maps a model-validation path back to the SPL text it came from. */
	private explain(path: string, message: string): { span: SplSpan; message: string } {
		const whole = { start: 0, end: this.text.length };
		const m = /^(\w+)\[(\d+)\](?:\.(\w+))?/.exec(path);
		const at = <T>(list: T[], fallback: T): T => (m ? list[Number(m[2])] ?? fallback : fallback);
		if (m) {
			switch (m[1]) {
				case 'filters': {
					const s = this.filterSpans[Number(m[2])];
					return { span: s ? (m[3] === 'value' ? s.value : s.whole) : whole, message };
				}
				case 'hops':
					return { span: at(this.hopSpans, whole), message };
				case 'columns':
					return { span: at(this.columnSpans, whole), message };
				case 'sort':
					return { span: at(this.sortSpans, whole), message };
			}
		}
		const agg = /^aggregation\.(measures|having|groupBy)\[(\d+)\]/.exec(path);
		if (agg) {
			const list = agg[1] === 'measures' ? this.measureSpans : agg[1] === 'having' ? this.havingSpans : this.groupBySpans;
			return { span: list[Number(agg[2])] ?? whole, message };
		}
		if (path === 'limit') return { span: this.limitSpan, message };
		if (path === 'columns')
			return { span: whole, message: `${message} — add a "| fields …" or "| stats …" stage` };
		return { span: whole, message };
	}
}

/**
 * Parses SPL text into a validated, runnable `QueryModel`. Ids (`h1…`, `f1…`, `c1…`) and column headers
 * are synthesised deterministically; namespaces come from the caller. Never throws.
 */
export function parseSpl(text: string, schema: BuilderSchema, opts: SplParseOptions): SplParseResult {
	const staged = parseSplStages(text);
	if (!staged.ok) return staged;
	try {
		const r = new Resolver(text, schema, opts);
		// Stage order: hops → filters → (stats [+ having] | fields) → sort → head, each at most once.
		const RANK: Record<string, number> = { hop: 0, where: 1, fields: 2, stats: 2, rename: 2, sort: 3, head: 4, top: 4 };
		let rank = 0;
		let last = 'root';
		let sawStats = false;
		let sawFields = false;
		const seen = new Set<string>();
		for (const stage of staged.stages) {
			if (stage.head && UNSUPPORTED_COMMANDS.has(COMMAND_SYNONYMS[stage.command] ?? stage.command))
				unsupported(stage.command, stage.head);
			const bracket = stage.args.find((a) => a.type === 'lbracket');
			if (bracket) {
				const close = stage.args.find((a) => a.type === 'rbracket' && a.start > bracket.start);
				unsupported('subsearch', { start: bracket.start, end: close ? close.end : bracket.end });
			}
			if (stage.command === 'root') {
				r.resolveRoot(stage);
				continue;
			}
			const command = COMMAND_SYNONYMS[stage.command] ?? stage.command;
			if (UNSUPPORTED_COMMANDS.has(command)) unsupported(command, stage.head!);
			const kind = COMMANDS.has(command) || EXTRA_COMMANDS.has(command) ? command : 'hop';
			const at = stage.head!;
			if (kind === 'where' && sawStats) {
				if (rank > 2) fail(`"where" must come before "${last}"`, at);
				for (const part of r.conditions(stage)) r.addHaving(part);
				continue;
			}
			if (RANK[kind] < rank) fail(`"${kind === 'hop' ? at.value : kind}" must come before "${last}"`, at);
			if (kind === 'fields' && sawStats) fail('"fields" cannot be combined with "stats"', at);
			if (kind === 'stats' && sawFields) fail('"stats" cannot be combined with "fields"', at);
			if (kind === 'stats' && sawStats) fail('Only one stats stage is supported', at);
			if (kind === 'top' && (sawStats || sawFields || seen.has('sort') || seen.has('head')))
				fail('"top" cannot be combined with "stats", "fields", "sort" or "head"', at);
			if (kind === 'rename' && !sawStats && !sawFields)
				fail('"rename" must come after "fields" or "stats"', at);
			if (kind !== 'hop' && kind !== 'where' && kind !== 'rename' && seen.has(kind))
				fail(`Only one ${kind} stage is supported`, at);
			seen.add(kind);
			rank = RANK[kind];
			if (kind !== 'hop') last = kind;
			switch (kind) {
				case 'hop':
					r.resolveHop(stage);
					break;
				case 'where':
					for (const part of r.conditions(stage)) r.addFilter(part);
					break;
				case 'rename':
					r.renameFields(stage);
					break;
				case 'top':
					sawStats = true;
					seen.add('stats');
					seen.add('sort');
					seen.add('head');
					r.setTop(stage);
					break;
				case 'fields':
					sawFields = true;
					r.setFields(stage);
					break;
				case 'stats':
					sawStats = true;
					r.setStats(stage);
					break;
				case 'sort':
					r.setSort(stage);
					break;
				case 'head':
					r.setHead(stage);
					break;
			}
		}
		return { ok: true, model: r.build() };
	} catch (e) {
		if (e instanceof SplFailure) return { ok: false, error: e.error };
		throw e;
	}
}
