import { describe, it, expect } from 'vitest';
import { parseTurtle, partitionQuads, RDF, RDFS, OWL, SH, SH_NS, type Quad } from './turtle';
import { checkShaclWellFormedness, checkStructural } from './validation';
import { buildBuilderSchema } from './query-builder-schema';
import { chainIssues, buildSocFetchedSchema, loadSocFile, SOC_SCHEMA_NS } from './soc-test-support';

/**
 * SOC sample dataset checks (`spec/spl-examples`): the `examples/soc/*.ttl` files parse, pass the same
 * validators Import Turtle runs, and keep the forward-only Alert → Event → LogFile → Server chain.
 * GraphDB-free — only the Turtle text is read.
 */

const BASE = 'http://ld.pageagent.com/example/soc';
const SCHEMA_NS = `${BASE}/schema#`;
const XSD = 'http://www.w3.org/2001/XMLSchema#';

const load = loadSocFile;

const schemaText = load('soc-schema.ttl');
const shapesText = load('soc-shapes.ttl');
const schema = parseTurtle(schemaText);
const shapes = parseTurtle(shapesText);

const termsOfType = (quads: Quad[], type: string) =>
	new Set(quads.filter((q) => q.predicate.value === RDF.type && q.object.value === type).map((q) => q.subject.value));
const local = (iri: string) => iri.slice(SCHEMA_NS.length);
const first = (quads: Quad[], s: string, p: string) =>
	quads.find((q) => q.subject.value === s && q.predicate.value === p)?.object.value;

const CLASSES = [
	'Server', 'LogFile', 'AuthenticationEvent', 'DetectionRule', 'Alert',
	'Severity', 'Outcome', 'AlertStatus', 'Criticality'
];
const DATATYPE: Record<string, [string, string]> = {
	hostname: ['Server', 'string'], ipAddress: ['Server', 'string'], operatingSystem: ['Server', 'string'],
	role: ['Server', 'string'],
	path: ['LogFile', 'string'], format: ['LogFile', 'string'],
	timestamp: ['AuthenticationEvent', 'dateTime'], user: ['AuthenticationEvent', 'string'],
	sourceIp: ['AuthenticationEvent', 'string'], method: ['AuthenticationEvent', 'string'],
	message: ['AuthenticationEvent', 'string'],
	ruleName: ['DetectionRule', 'string'], technique: ['DetectionRule', 'string'],
	description: ['DetectionRule', 'string'],
	alertId: ['Alert', 'string'], title: ['Alert', 'string'], raisedAt: ['Alert', 'dateTime']
};
const OBJECT: Record<string, [string, string]> = {
	criticality: ['Server', 'Criticality'],
	hostedOn: ['LogFile', 'Server'],
	recordedIn: ['AuthenticationEvent', 'LogFile'],
	outcome: ['AuthenticationEvent', 'Outcome'],
	severity: ['Alert', 'Severity'],
	status: ['Alert', 'AlertStatus'],
	detectedBy: ['Alert', 'DetectionRule'],
	triggeredBy: ['Alert', 'AuthenticationEvent']
};

describe('soc-schema.ttl (STORY-203)', () => {
	it('declares exactly the listed classes, in <base>/schema#', () => {
		const classes = termsOfType(schema, OWL.Class);
		expect([...classes].every((c) => c.startsWith(SCHEMA_NS))).toBe(true);
		expect([...classes].map(local).sort()).toEqual([...CLASSES].sort());
	});

	it('declares exactly the listed datatype properties with domain and xsd range', () => {
		const props = termsOfType(schema, OWL.DatatypeProperty);
		expect([...props].map(local).sort()).toEqual(Object.keys(DATATYPE).sort());
		for (const [name, [domain, range]] of Object.entries(DATATYPE)) {
			const iri = SCHEMA_NS + name;
			expect(first(schema, iri, RDFS.domain), name).toBe(SCHEMA_NS + domain);
			expect(first(schema, iri, RDFS.range), name).toBe(XSD + range);
		}
	});

	it('declares exactly the listed object properties, all pointing forward', () => {
		const props = termsOfType(schema, OWL.ObjectProperty);
		expect([...props].map(local).sort()).toEqual(Object.keys(OBJECT).sort());
		for (const [name, [domain, range]] of Object.entries(OBJECT)) {
			const iri = SCHEMA_NS + name;
			expect(first(schema, iri, RDFS.domain), name).toBe(SCHEMA_NS + domain);
			expect(first(schema, iri, RDFS.range), name).toBe(SCHEMA_NS + range);
		}
		expect(props.has(SCHEMA_NS + 'affectedServer')).toBe(false);
	});

	it('gives every term an rdfs:label and rdfs:comment', () => {
		const terms = [
			...termsOfType(schema, OWL.Class),
			...termsOfType(schema, OWL.DatatypeProperty),
			...termsOfType(schema, OWL.ObjectProperty)
		];
		for (const t of terms) {
			expect(first(schema, t, RDFS.label), `${t} label`).toBeTruthy();
			expect(first(schema, t, RDFS.comment), `${t} comment`).toBeTruthy();
		}
	});

	it('has no subjects outside <base>/schema# and passes the structural check', () => {
		expect(schema.every((q) => q.subject.value.startsWith(SCHEMA_NS))).toBe(true);
		expect(checkStructural(schema)).toEqual([]);
		const { shapes: s, instances } = partitionQuads(schema);
		expect(s).toEqual([]);
		expect(instances).toEqual([]);
	});

	it('starts with a header comment naming the prefix and base IRI', () => {
		const header = schemaText.split('\n').filter((l) => l.startsWith('#')).slice(0, 12).join('\n');
		expect(header).toContain(BASE);
		expect(header).toMatch(/prefix[^\n]*soc/i);
		expect(header).toMatch(/namespace[^\n]*active|active[^\n]*namespace/i);
	});
});

describe('soc-shapes.ttl (STORY-204)', () => {
	const declared = new Set(termsOfType(schema, OWL.Class));
	const nodeShapes = [...termsOfType(shapes, SH.NodeShape)];

	function propertyShapes(shapeIri: string) {
		return shapes
			.filter((q) => q.subject.value === shapeIri && q.predicate.value === SH.property)
			.map((q) => q.object.value)
			.map((ps) => ({
				path: first(shapes, ps, SH.path)!,
				min: first(shapes, ps, `${SH_NS}minCount`),
				max: first(shapes, ps, `${SH_NS}maxCount`),
				datatype: first(shapes, ps, `${SH_NS}datatype`),
				cls: first(shapes, ps, `${SH_NS}class`)
			}));
	}

	it('has one NodeShape per declared domain class (not enumerations) and is well-formed', () => {
		const targets = nodeShapes.map((s) => first(shapes, s, SH.targetClass)!).sort();
		expect(targets.map(local)).toEqual(
			['Alert', 'AuthenticationEvent', 'DetectionRule', 'LogFile', 'Server'].sort()
		);
		expect(checkShaclWellFormedness(shapes, declared)).toEqual([]);
		expect(shapes.some((q) => q.predicate.value === `${SH_NS}in`)).toBe(false);
	});

	it('is routed entirely to the shapes partition', () => {
		const p = partitionQuads(shapes);
		expect(p.schema).toEqual([]);
		expect(p.instances).toEqual([]);
	});

	it('refers only to terms declared in soc-schema.ttl, with matching datatype/class', () => {
		const declaredProps = new Set([...Object.keys(DATATYPE), ...Object.keys(OBJECT)].map((n) => SCHEMA_NS + n));
		for (const s of nodeShapes) {
			for (const ps of propertyShapes(s)) {
				expect(declaredProps.has(ps.path), ps.path).toBe(true);
				const name = local(ps.path);
				if (DATATYPE[name]) expect(ps.datatype, name).toBe(XSD + DATATYPE[name][1]);
				if (OBJECT[name]) expect(ps.cls, name).toBe(SCHEMA_NS + OBJECT[name][1]);
			}
		}
	});

	it('sets the cardinalities the builder reads', () => {
		const byPath = new Map<string, { min?: string; max?: string }>();
		for (const s of nodeShapes) for (const ps of propertyShapes(s)) byPath.set(local(ps.path), ps);
		const required = [
			'hostname', 'path', 'alertId', 'ruleName', 'timestamp',
			'recordedIn', 'hostedOn', 'triggeredBy', 'outcome', 'severity', 'status'
		];
		for (const n of required) expect(byPath.get(n)?.min, `${n} minCount`).toBe('1');
		expect(byPath.get('triggeredBy')?.max).toBeUndefined();
		for (const n of ['hostname', 'path', 'alertId', 'ruleName', 'timestamp', 'recordedIn', 'hostedOn', 'outcome', 'severity', 'status']) {
			expect(byPath.get(n)?.max, `${n} maxCount`).toBe('1');
		}
	});
});

describe('soc-data.ttl reference data (STORY-205)', () => {
	const DATA_NS = `${BASE}#`;
	const dataText = load('soc-data.ttl');
	const data = parseTurtle(dataText);
	const ofClass = (cls: string) =>
		new Set(data.filter((q) => q.predicate.value === RDF.type && q.object.value === SCHEMA_NS + cls).map((q) => q.subject.value));
	const all = (s: string, p: string) =>
		data.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value);

	it('has exactly the listed individuals of each class', () => {
		expect(ofClass('Server').size).toBe(6);
		expect(ofClass('LogFile').size).toBe(9);
		expect(ofClass('DetectionRule').size).toBe(3);
		expect(ofClass('Severity').size).toBe(4);
		expect(ofClass('Outcome').size).toBe(2);
		expect(ofClass('AlertStatus').size).toBe(3);
		expect(ofClass('Criticality').size).toBe(3);
	});

	it('types every individual with a declared class and labels it, in the instances partition', () => {
		const declared = termsOfType(schema, OWL.Class);
		const subjects = new Set(data.map((q) => q.subject.value));
		for (const s of subjects) {
			expect(s.startsWith(DATA_NS), s).toBe(true);
			const types = all(s, RDF.type);
			expect(types.length, s).toBeGreaterThan(0);
			for (const t of types) expect(declared.has(t), `${s} a ${t}`).toBe(true);
			expect(all(s, RDFS.label).length, `${s} label`).toBe(1);
		}
		expect(checkStructural([...schema, ...data])).toEqual([]);
	});

	it('hosts every logfile on exactly one server and gives every server a criticality', () => {
		const servers = ofClass('Server');
		for (const f of ofClass('LogFile')) {
			const hosts = all(f, SCHEMA_NS + 'hostedOn');
			expect(hosts.length, f).toBe(1);
			expect(servers.has(hosts[0]), f).toBe(true);
		}
		for (const s of servers) expect(all(s, SCHEMA_NS + 'criticality').length, s).toBe(1);
	});

	it('contains only RFC 5737 addresses and example.com hostnames', () => {
		const body = dataText
			.split('\n')
			.filter((l) => !l.startsWith('#') && !l.startsWith('@prefix'))
			.join('\n');
		const ips = body.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? [];
		for (const ip of ips) expect(ip, ip).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\./);
		const hosts = body.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io)\b/gi) ?? [];
		for (const h of hosts) expect(h, h).toMatch(/(^|\.)example\.com$/);
	});
});

describe('soc-data.ttl events and alerts (STORY-206)', () => {
	const DATA_NS = `${BASE}#`;
	const data = parseTurtle(load('soc-data.ttl'));
	const P = (n: string) => SCHEMA_NS + n;
	const ofClass = (cls: string) => [
		...new Set(data.filter((q) => q.predicate.value === RDF.type && q.object.value === P(cls)).map((q) => q.subject.value))
	];
	const all = (s: string, p: string) =>
		data.filter((q) => q.subject.value === s && q.predicate.value === p).map((q) => q.object.value);
	const one = (s: string, p: string) => {
		const v = all(s, p);
		expect(v.length, `${s} ${local(p)}`).toBe(1);
		return v[0];
	};
	const d = (n: string) => `${DATA_NS}${n}`;
	const events = ofClass('AuthenticationEvent');
	const alerts = ofClass('Alert');
	const FAILURE = d('outcomeFailure');
	const SUCCESS = d('outcomeSuccess');
	const alertByCode = (code: string) => alerts.find((a) => first(data, a, P('alertId')) === code)!;

	it('has 70 events and 4 alerts with every required property', () => {
		expect(events).toHaveLength(70);
		expect(alerts).toHaveLength(4);
		for (const e of events) {
			for (const p of ['timestamp', 'user', 'sourceIp', 'method', 'message', 'recordedIn', 'outcome']) one(e, P(p));
		}
		for (const a of alerts) {
			for (const p of ['alertId', 'title', 'raisedAt', 'severity', 'status', 'detectedBy']) one(a, P(p));
			expect(all(a, P('triggeredBy')).length, a).toBeGreaterThan(0);
		}
	});

	it('uses valid xsd:dateTime timestamps', () => {
		const stamps = data.filter((q) => [P('timestamp'), P('raisedAt')].includes(q.predicate.value));
		expect(stamps).toHaveLength(74);
		for (const q of stamps) {
			expect(q.object.termType).toBe('Literal');
			expect((q.object as { datatype: { value: string } }).datatype.value).toBe(`${XSD}dateTime`);
			expect(Number.isNaN(Date.parse(q.object.value)), q.object.value).toBe(false);
		}
	});

	it('matches the golden outcome and failed-source counts', () => {
		const byOutcome = (o: string) => events.filter((e) => one(e, P('outcome')) === o);
		expect(byOutcome(FAILURE)).toHaveLength(29);
		expect(byOutcome(SUCCESS)).toHaveLength(41);
		const failuresBySource: Record<string, number> = {};
		for (const e of byOutcome(FAILURE)) {
			const ip = one(e, P('sourceIp'));
			failuresBySource[ip] = (failuresBySource[ip] ?? 0) + 1;
		}
		expect(failuresBySource).toEqual({
			'203.0.113.45': 13,
			'198.51.100.7': 8,
			'192.0.2.10': 7,
			'192.0.2.88': 1
		});
	});

	it('maps alerts to severity, status, rule and triggering events per scenario', () => {
		const expected: Record<string, { sev: string; status: string; rule: string; n: number }> = {
			'A-1001': { sev: 'severityHigh', status: 'alertStatusInvestigating', rule: 'ruleSshBruteForce', n: 13 },
			'A-1002': { sev: 'severityMedium', status: 'alertStatusOpen', rule: 'rulePasswordSpray', n: 8 },
			'A-1003': { sev: 'severityLow', status: 'alertStatusClosed', rule: 'ruleSshBruteForce', n: 7 },
			'A-1004': { sev: 'severityHigh', status: 'alertStatusInvestigating', rule: 'ruleOffHoursPrivilegedLogin', n: 1 }
		};
		for (const [code, e] of Object.entries(expected)) {
			const a = alertByCode(code);
			expect(a, code).toBeTruthy();
			expect(one(a, P('severity')), code).toBe(d(e.sev));
			expect(one(a, P('status')), code).toBe(d(e.status));
			expect(one(a, P('detectedBy')), code).toBe(d(e.rule));
			expect(all(a, P('triggeredBy')), code).toHaveLength(e.n);
		}
	});

	it('traces each alert to the expected logfiles', () => {
		const files = (code: string) => {
			const counts: Record<string, number> = {};
			for (const e of all(alertByCode(code), P('triggeredBy'))) {
				const file = one(e, P('recordedIn')).slice(DATA_NS.length);
				counts[file] = (counts[file] ?? 0) + 1;
			}
			return counts;
		};
		expect(files('A-1001')).toEqual({ 'web-01-auth-log': 13 });
		expect(files('A-1002')).toEqual({ 'web-01-auth-log': 3, 'web-02-auth-log': 3, 'app-01-auth-log': 2 });
		expect(files('A-1003')).toEqual({ 'db-01-auth-log': 7 });
		expect(files('A-1004')).toEqual({ 'dc-01-security-evtx': 1 });
		for (const e of events) {
			const file = one(e, P('recordedIn'));
			expect(file, e).toMatch(/-(auth-log|security-evtx)$/);
			expect(all(file, P('hostedOn')), file).toHaveLength(1);
		}
	});

	it('A-1004 is triggered by the 03:12 RDP success of Administrator', () => {
		const [e] = all(alertByCode('A-1004'), P('triggeredBy'));
		expect(one(e, P('outcome'))).toBe(SUCCESS);
		expect(one(e, P('user'))).toBe('Administrator');
		expect(one(e, P('sourceIp'))).toBe('192.0.2.88');
		expect(one(e, P('method'))).toBe('rdp');
		expect(one(e, P('timestamp'))).toMatch(/T03:12:\d\d/);
	});

	it('finds 203.0.113.45 in exactly 14 individuals, all events on web-01 and bastion-01', () => {
		const hits = new Set(
			data.filter((q) => q.object.termType === 'Literal' && q.object.value.includes('203.0.113.45')).map((q) => q.subject.value)
		);
		expect(hits.size).toBe(14);
		for (const h of hits) expect(events).toContain(h);
		const servers = new Set([...hits].map((e) => all(all(e, P('recordedIn'))[0], P('hostedOn'))[0]));
		expect([...servers].sort()).toEqual([d('bastion-01'), d('web-01')]);
	});
});

describe('merged import validation and chain completeness (STORY-207)', () => {
	const data = parseTurtle(load('soc-data.ttl'));
	const merged = [...schema, ...shapes, ...data];

	it('passes structural and SHACL well-formedness validation on schema + shapes + data together', () => {
		const declared = termsOfType(merged, OWL.Class);
		expect(checkStructural(merged)).toEqual([]);
		expect(checkShaclWellFormedness(merged, declared)).toEqual([]);
	});

	it('has a complete chain: event → logfile → server, alert → ≥1 event', () => {
		expect(chainIssues(merged)).toEqual([]);
	});

	it('detects a broken chain (mutated copy with one recordedIn removed)', () => {
		const victim = merged.find((q) => q.predicate.value === `${SOC_SCHEMA_NS}recordedIn`)!;
		const mutated = merged.filter((q) => q !== victim);
		const issues = chainIssues(mutated);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toContain(victim.subject.value);
	});

	it('detects an alert with no triggering event and a logfile without a server', () => {
		const noTrigger = merged.filter((q) => q.predicate.value !== `${SOC_SCHEMA_NS}triggeredBy`);
		expect(chainIssues(noTrigger).length).toBe(4);
		const noHost = merged.filter((q) => q.predicate.value !== `${SOC_SCHEMA_NS}hostedOn`);
		expect(chainIssues(noHost).length).toBeGreaterThan(0);
	});

	it('builds a FetchedSchema whose cardinality flags match the shapes', () => {
		const fetched = buildSocFetchedSchema(merged);
		const rel = (n: string) => fetched.objectProperties.find((p) => p.iri === SOC_SCHEMA_NS + n)!;
		for (const n of ['recordedIn', 'hostedOn', 'outcome', 'severity', 'status']) {
			expect(rel(n).required, n).toBe(true);
			expect(rel(n).repeatable, n).toBe(false);
		}
		expect(rel('triggeredBy').required).toBe(true);
		expect(rel('triggeredBy').repeatable).toBe(true);
		expect(rel('detectedBy').required).toBe(false);
		const attr = (n: string) => fetched.datatypeProperties.find((p) => p.iri === SOC_SCHEMA_NS + n)!;
		expect(attr('hostname').required).toBe(true);
		expect(attr('user').required).toBe(false);
		expect(fetched.shapeInConstraints).toEqual([]);
	});

	it('feeds the query builder: enumerations are detected, domain classes are not', () => {
		const builder = buildBuilderSchema(buildSocFetchedSchema(merged));
		const cls = (n: string) => builder.classes.get(SOC_SCHEMA_NS + n)!;
		for (const n of ['Severity', 'Outcome', 'AlertStatus', 'Criticality']) expect(cls(n).isEnumeration, n).toBe(true);
		for (const n of ['Server', 'LogFile', 'AuthenticationEvent', 'DetectionRule', 'Alert']) {
			expect(cls(n).isEnumeration, n).toBe(false);
		}
		expect(cls('Severity').members.map((m) => m.label).sort()).toEqual(['Critical', 'High', 'Low', 'Medium']);
		expect(cls('Alert').relationships.map((r) => r.label).sort()).toEqual([
			'detectedBy', 'severity', 'status', 'triggeredBy'
		]);
	});
});
