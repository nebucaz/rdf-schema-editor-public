/**
 * Pure model of the validation report (spec/validation-report-by-identity STORY-363): grouping,
 * sorting, counting and value text, shared by the view and the exports so both show the same thing.
 * No DOM, no fetch.
 */

/** One finding of `GET /validation/report` (`backend/internal/validation/check.go`'s `Violation`). */
export interface ValidationFinding {
	individualIri: string;
	individualLabel: string;
	typeIri: string;
	path: string;
	constraint: string;
	message: string;
	ruleId: string;
	qualityDimension: string;
	shapeIri: string;
	/** The offending value; absent for minCount/maxCount and for a sh:sparql row without `?value`. */
	value?: string;
}

export type ReportView = 'identity' | 'rule' | 'dimension' | 'none';

export interface FindingGroup {
	key: string;
	title: string;
	findings: ValidationFinding[];
}

export interface ReportSummary {
	findings: number;
	identities: number;
	byRule: { ruleId: string; count: number }[];
	byDimension: { dimension: string; count: number }[];
}

export interface ValueCell {
	kind: 'none' | 'literal' | 'iri' | 'datatype';
	text: string;
}

const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

function bucket(findings: ValidationFinding[], keyOf: (f: ValidationFinding) => string): Map<string, ValidationFinding[]> {
	const out = new Map<string, ValidationFinding[]>();
	for (const f of findings) {
		const key = keyOf(f);
		const list = out.get(key);
		if (list) list.push(f);
		else out.set(key, [f]);
	}
	return out;
}

/** Named keys alphabetical, the empty key (shown as `emptyTitle`) last. */
function namedThenEmpty(map: Map<string, ValidationFinding[]>, emptyTitle: string): FindingGroup[] {
	const named = [...map.keys()].filter((k) => k !== '').sort(compareText);
	const keys = map.has('') ? [...named, ''] : named;
	return keys.map((key) => ({ key, title: key === '' ? emptyTitle : key, findings: map.get(key)! }));
}

export function groupFindings(findings: ValidationFinding[], view: ReportView): FindingGroup[] {
	if (findings.length === 0) return [];
	switch (view) {
		case 'none':
			return [{ key: 'all', title: 'All findings', findings: [...findings] }];
		case 'rule':
			return namedThenEmpty(bucket(findings, (f) => f.ruleId?.trim() ?? ''), 'No rule id');
		case 'dimension':
			return namedThenEmpty(bucket(findings, (f) => f.qualityDimension?.trim() ?? ''), 'Unspecified');
		case 'identity':
			return [...bucket(findings, (f) => f.individualIri)]
				.map(([key, rows]) => ({ key, title: rows[0].individualLabel || key, findings: rows }))
				.sort((a, b) => b.findings.length - a.findings.length || compareText(a.title, b.title) || compareText(a.key, b.key));
	}
}

function counts(keys: string[]): { key: string; count: number }[] {
	const map = new Map<string, number>();
	for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1);
	return [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}

export function summarize(findings: ValidationFinding[]): ReportSummary {
	return {
		findings: findings.length,
		identities: new Set(findings.map((f) => f.individualIri)).size,
		byRule: counts(findings.map((f) => f.ruleId?.trim() ?? '')).map(({ key, count }) => ({ ruleId: key, count })),
		byDimension: counts(findings.map((f) => f.qualityDimension?.trim() ?? '')).map(({ key, count }) => ({ dimension: key, count }))
	};
}

/** What the Value column shows. The view turns `iri` and `datatype` into CURIEs and quotes `literal`
 *  so that `""` and `"  "` are visible. */
export function valueCell(f: ValidationFinding): ValueCell {
	if (f.value === undefined) return { kind: 'none', text: '' };
	if (f.constraint === 'datatype') return { kind: 'datatype', text: f.value };
	if (f.constraint === 'class') return { kind: 'iri', text: f.value };
	return { kind: 'literal', text: f.value };
}

/** The stable key of a finding: never the value, the message or the label. */
export function findingKey(f: ValidationFinding): string {
	return [f.individualIri, f.ruleId, f.path, f.constraint].join('\u0000');
}
