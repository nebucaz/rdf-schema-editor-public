/**
 * The SOC runbook's queries (`examples/soc/RUNBOOK.md`) as `QueryModel`s plus the SPL text the builder's
 * *Show query* drawer prints for each. The runbook quotes `spl` verbatim; `soc-runbook-queries.spec.ts`
 * asserts `printSplPipeline(model) === spl`, so the runbook cannot drift from the engine.
 * Test-only — nothing in the app imports this module.
 */
import { emptyQueryModel, type QueryModel } from './query-model';
import { SOC_BASE_IRI, SOC_SCHEMA_NS } from './soc-test-support';

const cls = (n: string) => `${SOC_SCHEMA_NS}${n}`;
const prop = (n: string) => ({ propertyIri: cls(n) });
const member = (n: string) => `${SOC_BASE_IRI}#${n}`;
const hop = (id: string, parent: string | null, p: string, target: string) => ({
	id,
	parentHopId: parent,
	propertyIri: cls(p),
	direction: 'forward' as const,
	targetClassIri: cls(target)
});
const col = (id: string, hopId: string | null, p: string) => ({ id, hopId, source: prop(p), header: p });

export const runbookQueryModel = {
	/** R3 — which logfile and server produced the High-severity alerts. */
	alertsByServer(): QueryModel {
		return {
			...emptyQueryModel(cls('Alert'), [SOC_BASE_IRI]),
			hops: [
				hop('h1', null, 'triggeredBy', 'AuthenticationEvent'),
				hop('h2', 'h1', 'recordedIn', 'LogFile'),
				hop('h3', 'h2', 'hostedOn', 'Server')
			],
			filters: [{ id: 'f1', hopId: null, propertyIri: cls('severity'), op: 'eq', value: member('severityHigh') }],
			columns: [
				col('alertId', null, 'alertId'),
				col('title', null, 'title'),
				col('timestamp', 'h1', 'timestamp'),
				col('path', 'h2', 'path'),
				col('hostname', 'h3', 'hostname')
			]
		};
	},

	/** R4 — failed logins per source address, noisiest first (top-N by sorting; there is no HAVING). */
	topFailingSources(): QueryModel {
		return {
			...emptyQueryModel(cls('AuthenticationEvent'), [SOC_BASE_IRI]),
			filters: [{ id: 'f1', hopId: null, propertyIri: cls('outcome'), op: 'eq', value: member('outcomeFailure') }],
			columns: [col('sourceIp', null, 'sourceIp')],
			aggregation: {
				groupBy: ['sourceIp'],
				measures: [{ fn: 'count', of: 'root', alias: 'count' }]
			},
			sort: [{ columnId: 'count', direction: 'desc' }]
		};
	},

	/** R5 — blast radius of one source address: events and distinct users per server. */
	blastRadius(sourceIp = '203.0.113.45'): QueryModel {
		return {
			...emptyQueryModel(cls('AuthenticationEvent'), [SOC_BASE_IRI]),
			hops: [hop('h1', null, 'recordedIn', 'LogFile'), hop('h2', 'h1', 'hostedOn', 'Server')],
			filters: [{ id: 'f1', hopId: null, propertyIri: cls('sourceIp'), op: 'eq', value: sourceIp }],
			columns: [col('hostname', 'h2', 'hostname'), col('user', null, 'user')],
			aggregation: {
				groupBy: ['hostname'],
				measures: [
					{ fn: 'count', of: 'root', alias: 'events' },
					{ fn: 'countDistinct', of: 'user', alias: 'users' }
				]
			},
			sort: [{ columnId: 'events', direction: 'desc' }]
		};
	}
};

export interface RunbookQuery {
	title: string;
	model: QueryModel;
	/** The SPL pipeline the *Show query* drawer prints for `model`. */
	spl: string;
}

export const RUNBOOK_QUERIES: Record<'R3' | 'R4' | 'R5', RunbookQuery> = {
	R3: {
		title: 'Alert → logfile → server',
		model: runbookQueryModel.alertsByServer(),
		spl: [
			'Alert',
			'| triggeredBy',
			'| triggeredBy.recordedIn',
			'| triggeredBy.recordedIn.hostedOn',
			'| where severity="High"',
			'| fields alertId, title, triggeredBy.timestamp, triggeredBy.recordedIn.path, triggeredBy.recordedIn.hostedOn.hostname'
		].join('\n')
	},
	R4: {
		title: 'Top failing sources',
		model: runbookQueryModel.topFailingSources(),
		spl: [
			'Authentication event',
			'| where outcome="Failure"',
			'| stats count as count by sourceIp',
			'| sort -count'
		].join('\n')
	},
	R5: {
		title: 'Blast radius of one source',
		model: runbookQueryModel.blastRadius(),
		spl: [
			'Authentication event',
			'| recordedIn',
			'| recordedIn.hostedOn',
			'| where sourceIp="203.0.113.45"',
			'| stats count as events, dc(user) as users by recordedIn.hostedOn.hostname',
			'| sort -events'
		].join('\n')
	}
};

const failingSources = runbookQueryModel.topFailingSources();

/** SPL-only variants of R4 the runbook offers once the reader has pasted the base query (STORY-223). */
export const RUNBOOK_VARIANTS: Record<'R4_TOP' | 'R4_OVER_7', RunbookQuery> = {
	R4_TOP: {
		title: 'Top 5 failing sources (top)',
		model: { ...failingSources, limit: 5 },
		spl: ['Authentication event', '| where outcome="Failure"', '| top 5 sourceIp'].join('\n')
	},
	R4_OVER_7: {
		title: 'Sources with more than 7 failures',
		model: {
			...failingSources,
			aggregation: {
				...failingSources.aggregation!,
				having: [{ measure: 'count', op: 'gt', value: 7 }]
			}
		},
		spl: [
			'Authentication event',
			'| where outcome="Failure"',
			'| stats count as count by sourceIp',
			'| where count>7',
			'| sort -count'
		].join('\n')
	}
};
