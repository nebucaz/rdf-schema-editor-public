import { describe, expect, it } from 'vitest';
import { callerFromStack, createRequestLog, summarizeRequests } from './request-log';

const STACK = `Error
    at SparqlConnector.executeQuery (http://localhost:5173/src/lib/services/sparql-connector.ts:8030:20)
    at SparqlConnector.selectQuery (http://localhost:5173/src/lib/services/sparql-connector.ts:965:15)
    at SparqlConnector.fetchAllClasses (http://localhost:5173/src/lib/services/sparql-connector.ts:5960:30)
    at SparqlConnector.fetchFullSchema (http://localhost:5173/src/lib/services/sparql-connector.ts:6320:12)`;

describe('callerFromStack', () => {
	it('names the first frame that is not request plumbing', () => {
		expect(callerFromStack(STACK)).toBe('fetchAllClasses');
	});

	it('understands async frames', () => {
		const stack = `Error
    at SparqlConnector.executeQuery (x.ts:1:1)
    at async SparqlConnector.fetchNamespaces (x.ts:2:2)`;
		expect(callerFromStack(stack)).toBe('fetchNamespaces');
	});

	it('falls back to an anonymous frame label, never throws', () => {
		expect(callerFromStack(undefined)).toBe('(unknown)');
		expect(callerFromStack('Error\n    at SparqlConnector.executeQuery (x.ts:1:1)')).toBe('(unknown)');
		expect(callerFromStack('Error\n    at SparqlConnector.executeQuery (x.ts:1:1)\n    at http://localhost/x.js:3:3')).toBe('(anonymous)');
	});
});

describe('summarizeRequests', () => {
	it('groups by caller, most requests first, with totals', () => {
		const rows = summarizeRequests([
			{ seq: 1, kind: 'query', caller: 'a', ms: 10, ok: true },
			{ seq: 2, kind: 'query', caller: 'b', ms: 5, ok: true },
			{ seq: 3, kind: 'query', caller: 'a', ms: 20, ok: false }
		]);
		expect(rows).toEqual([
			{ caller: 'a', count: 2, totalMs: 30, failed: 1 },
			{ caller: 'b', count: 1, totalMs: 5, failed: 0 }
		]);
	});
});

describe('createRequestLog', () => {
	it('records in order, can be cleared, and is capped', () => {
		const log = createRequestLog(3);
		for (let i = 0; i < 5; i++) log.record({ kind: 'query', caller: `c${i}`, ms: 1, ok: true });
		expect(log.entries.map((e) => e.caller)).toEqual(['c2', 'c3', 'c4']);
		expect(log.entries.map((e) => e.seq)).toEqual([3, 4, 5]);
		log.clear();
		expect(log.entries).toEqual([]);
	});
});
