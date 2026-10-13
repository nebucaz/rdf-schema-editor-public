/**
 * Presentation helpers for SPL feedback (spl-input STORY-221). Pure: turns a positioned
 * `SplParseError` into the offending line plus a caret marker, and decides when the free-text
 * search box should *offer* (never force) SPL mode.
 */
import type { SplParseError } from './query-spl-parser';

export interface FormattedSplError {
	message: string;
	/** 1-based line and column (in characters, astral code points count once). */
	line: number;
	column: number;
	/** The source line the error falls on, without its line terminator. */
	lineText: string;
	/** Prefix whitespace (tabs preserved) followed by `^` under the offending range. */
	marker: string;
	suggestions: string[];
	helpTopic?: string;
}

export function formatSplError(text: string, error: SplParseError): FormattedSplError {
	const start = Math.min(Math.max(error.start, 0), text.length);
	const lineStart = text.lastIndexOf('\n', start - 1) + 1;
	const nl = text.indexOf('\n', start);
	let lineEnd = nl === -1 ? text.length : nl;
	if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd -= 1;

	const lineText = text.slice(lineStart, lineEnd);
	const line = text.slice(0, lineStart).split('\n').length;
	const before = Array.from(text.slice(lineStart, start));
	const spanEnd = Math.min(Math.max(error.end, start), Math.max(lineEnd, start));
	const carets = Math.max(1, Array.from(text.slice(start, spanEnd)).length);

	return {
		message: error.message,
		line,
		column: before.length + 1,
		lineText,
		marker: before.map((c) => (c === '\t' ? '\t' : ' ')).join('') + '^'.repeat(carets),
		suggestions: error.expected ?? [],
		...(error.helpTopic ? { helpTopic: error.helpTopic } : {})
	};
}

/** Free-text input containing a pipe is probably SPL; the UI only offers the switch. */
export function shouldOfferSplMode(text: string): boolean {
	return text.includes('|');
}
