/**
 * Serializers for the validation report export (spec/validation-report-by-identity STORY-366): pure
 * functions from what is on screen to a string. Nothing is persisted or sent anywhere. CSV and JSON
 * are always flat; Markdown follows the chosen view.
 */

import { toCsv } from '#lib/utils/csv.js';
import { extractLocalName } from '#lib/utils/iri.js';
import type { IssueOutcome } from './issues-client.js';
import {
	groupFindings,
	summarize,
	valueCell,
	type ReportView,
	type ValidationFinding
} from './validation-report-model.js';

/** A constraint the run could not check (`backend/internal/validation`'s `NotChecked`). */
export interface NotCheckedEntry {
	shapeIri: string;
	ruleId: string;
	construct: string;
	reason: string;
}

export interface ReportExportInput {
	/** The visible, namespace-filtered findings. */
	findings: ValidationFinding[];
	notChecked: NotCheckedEntry[];
	view: ReportView;
	runAt: Date;
	appVersion: string;
	hiddenNamespaces: string[];
	/** The run's issues by finding id (STORY-387); absent when the report was not reconciled. */
	issues?: Map<string, IssueOutcome> | Record<string, IssueOutcome>;
}

export type ExportKind = 'csv' | 'json' | 'md';

function issueOf(input: ReportExportInput, findingId: string): IssueOutcome | undefined {
	const { issues } = input;
	return issues instanceof Map ? issues.get(findingId) : issues?.[findingId];
}

export function exportFilename(kind: ExportKind, runAt: Date): string {
	return `validation-report-${runAt.toISOString().slice(0, 10)}.${kind}`;
}

const CSV_COLUMNS = ['kind', 'identity', 'label', 'type', 'rule', 'dimension', 'path', 'constraint', 'value', 'message', 'shape', 'findingId', 'issueStatus', 'assignee', 'issueId', 'externalUrl'];

export function reportToCsv(input: ReportExportInput): string {
	const findings = input.findings.map((f) => {
		const issue = issueOf(input, f.id);
		return [
			'finding', f.individualIri, f.individualLabel, f.typeIri, f.ruleId, f.qualityDimension,
			f.path, f.constraint, f.value ?? '', f.message, f.shapeIri, f.id,
			issue?.status ?? '', issue?.assignee ?? '', issue?.issueId ?? '', issue?.externalUrl ?? ''
		];
	});
	const notChecked = input.notChecked.map((n) => [
		'notChecked', '', '', '', n.ruleId, '', '', n.construct, '', n.reason, n.shapeIri, '', '', '', '', ''
	]);
	return toCsv(CSV_COLUMNS, [...findings, ...notChecked]);
}

export function reportToJson(input: ReportExportInput): string {
	const summary = summarize(input.findings);
	return JSON.stringify(
		{
			generatedAt: input.runAt.toISOString(),
			appVersion: input.appVersion,
			view: input.view,
			counts: { findings: summary.findings, identities: summary.identities },
			filter: { hiddenNamespaces: input.hiddenNamespaces },
			violations: input.findings.map((f) => {
				const issue = issueOf(input, f.id);
				return issue ? { ...f, issue } : f;
			}),
			notChecked: input.notChecked
		},
		null,
		2
	);
}

/** Escapes text for a Markdown table cell: pipes, newlines, markup characters and angle brackets (no raw HTML). */
function cell(text: string): string {
	return text
		.replace(/[\\`*[\]|]/g, (c) => `\\${c}`)
		.replace(/\r?\n|\r/g, ' ')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function valueMarkdown(f: ValidationFinding): string {
	const v = valueCell(f);
	if (v.kind === 'none') return '';
	if (v.kind === 'literal') return cell(`"${v.text}"`);
	return cell(extractLocalName(v.text));
}

function table(input: ReportExportInput, findings: ValidationFinding[], withIdentity: boolean): string[] {
	const head = withIdentity
		? ['Identity', 'Type', 'Rule', 'Path', 'Constraint', 'Value', 'Message', 'Id', 'Status', 'Assignee']
		: ['Rule', 'Path', 'Constraint', 'Value', 'Message', 'Id', 'Status', 'Assignee'];
	const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
	for (const f of findings) {
		const cols = [
			...(withIdentity ? [cell(f.individualLabel || extractLocalName(f.individualIri)), cell(extractLocalName(f.typeIri))] : []),
			cell(f.ruleId),
			cell(extractLocalName(f.path)),
			cell(f.constraint),
			valueMarkdown(f),
			cell(f.message),
			cell(f.id),
			cell(issueOf(input, f.id)?.status ?? ''),
			cell(issueOf(input, f.id)?.assignee ?? '')
		];
		lines.push(`| ${cols.join(' | ')} |`);
	}
	return lines;
}

export function reportToMarkdown(input: ReportExportInput): string {
	const summary = summarize(input.findings);
	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const lines = [
		'# Validation report',
		'',
		`- Run: ${input.runAt.toISOString()}`,
		`- App version: ${input.appVersion}`,
		`- Result: ${plural(summary.findings, 'finding', 'findings')} in ${plural(summary.identities, 'identity', 'identities')}`,
		`- Hidden namespaces: ${input.hiddenNamespaces.length ? input.hiddenNamespaces.map(cell).join(', ') : 'none'}`,
		''
	];

	if (input.notChecked.length > 0) {
		lines.push('## Not checked', '', '| Rule | Construct | Reason | Shape |', '| --- | --- | --- | --- |');
		for (const n of input.notChecked) lines.push(`| ${cell(n.ruleId)} | ${cell(n.construct)} | ${cell(n.reason)} | ${cell(n.shapeIri)} |`);
		lines.push('');
	}

	lines.push('## Findings', '');
	if (input.findings.length === 0) {
		lines.push('No findings.');
	} else if (input.view === 'none') {
		lines.push(...table(input, input.findings, true));
	} else {
		for (const group of groupFindings(input.findings, input.view)) {
			const n = group.findings.length;
			lines.push(input.view === 'identity' ? `### ${cell(group.title)} (${plural(n, 'finding', 'findings')})` : `### ${cell(group.title)} (${n})`, '');
			if (input.view === 'identity') lines.push(`${cell(group.key)}`, '');
			lines.push(...table(input, group.findings, input.view !== 'identity'), '');
		}
	}
	return lines.join('\n').replace(/\n+$/, '\n');
}
