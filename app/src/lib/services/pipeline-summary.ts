/**
 * Where each namespace stands in the six pipeline stages (ontology-pipeline STORY-320). Pure: counts come from
 * the loaded schema, findings from the gates and results from the competency question runs. A stage without
 * data is "not started", never an error and never hidden.
 */
import { buildIdentitySearchUrl } from '#lib/utils/identity-search-url.js';
import { appUrl } from '#lib/utils/urls.js';
import type { CompetencyQuestion, CompetencyQuestionRun } from './competency-question';
import { buildReportRows } from './competency-question-report';
import type { GateFinding, PipelineStage } from './gates/types';
import type { FetchedSchema } from './sparql-connector';

export const STAGE_IDS = ['vocabulary', 'taxonomy', 'thesaurus', 'ontology', 'validation', 'application'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export interface StageStat {
	label: string;
	value: number | string;
	/** The screen that lists what was counted. */
	href?: string;
}

export interface StageSummary {
	stage: StageId;
	status: 'not-started' | 'in-progress';
	stats: StageStat[];
	warnings: number;
	infos: number;
}

export interface NamespaceSummary {
	namespaceBaseIri: string;
	prefix: string;
	stages: StageSummary[];
}

export interface PipelineSummaryInput {
	schema: FetchedSchema;
	namespaces: { baseIri: string; prefix: string }[];
	findings: GateFinding[];
	questions: CompetencyQuestion[];
	runs: CompetencyQuestionRun[];
}

/** Which of the six stages a gate's stage is shown under; governance has no stage of its own here. */
const STAGE_OF_GATE: Partial<Record<PipelineStage, StageId>> = {
	vocabulary: 'vocabulary',
	metadata: 'vocabulary',
	taxonomy: 'taxonomy',
	thesaurus: 'thesaurus',
	ontology: 'ontology',
	knowledgeGraph: 'application'
};

export function pipelineSummary(input: PipelineSummaryInput): NamespaceSummary[] {
	const { schema, findings, questions, runs } = input;

	const namespaceOfElement = new Map<string, string>();
	for (const e of [
		...schema.classes,
		...schema.datatypeProperties,
		...schema.objectProperties,
		...(schema.shapes ?? []),
		...schema.individuals,
		...(schema.untypedIndividuals ?? [])
	]) {
		namespaceOfElement.set(e.iri, e.namespaceBaseIri);
	}
	const reportRows = buildReportRows(questions, runs);

	return input.namespaces.map(({ baseIri, prefix }) => {
		const classes = schema.classes.filter((c) => c.namespaceBaseIri === baseIri).length;
		const properties = [...schema.datatypeProperties, ...schema.objectProperties].filter(
			(p) => p.namespaceBaseIri === baseIri
		).length;
		const individuals =
			schema.individuals.filter((i) => i.namespaceBaseIri === baseIri).length +
			(schema.untypedIndividuals ?? []).filter((i) => i.namespaceBaseIri === baseIri).length;

		const findingsFor = (id: StageId) => {
			const mine = findings.filter(
				(f) => STAGE_OF_GATE[f.stage] === id && namespaceOfElement.get(f.elementIri) === baseIri
			);
			return {
				warnings: mine.filter((f) => f.severity === 'warning').length,
				infos: mine.filter((f) => f.severity === 'info').length
			};
		};
		const findingStat = (counts: { warnings: number; infos: number }): StageStat[] =>
			counts.warnings + counts.infos > 0
				? [{ label: 'Findings', value: counts.warnings + counts.infos, href: appUrl('/validation?tab=gates') }]
				: [];

		const stage = (id: StageId, status: StageSummary['status'], stats: StageStat[], counts = findingsFor(id)): StageSummary => ({
			stage: id,
			status,
			stats: [...stats, ...(id === 'validation' ? [] : findingStat(counts))],
			warnings: counts.warnings,
			infos: counts.infos
		});
		const notStarted = (id: StageId) => stage(id, 'not-started', []);

		// A question belongs to the namespaces of the elements it is linked to.
		const mine = reportRows.filter((r) =>
			r.question.linkedElements.some((iri) => namespaceOfElement.get(iri) === baseIri)
		);
		const ran = mine.filter((r) => r.latest);
		const passing = ran.filter((r) => r.latest!.outcome === 'pass').length;
		const regressions = mine.filter((r) => r.regression).length;

		// The competency questions are the ontology's test harness (book p. 240), so they are shown under it.
		const questionStats: StageStat[] = [];
		if (mine.length > 0) questionStats.push({ label: 'Questions', value: mine.length, href: appUrl('/questions') });
		if (ran.length > 0) {
			questionStats.push({ label: 'Passing', value: `${passing} of ${ran.length} run`, href: appUrl('/questions#results') });
		}
		if (regressions > 0) questionStats.push({ label: 'Regressions', value: regressions, href: appUrl('/questions#results') });

		const shapes = (schema.shapes ?? []).filter((s) => s.namespaceBaseIri === baseIri).length;

		const application = findingsFor('application');
		return {
			namespaceBaseIri: baseIri,
			prefix,
			stages: [
				notStarted('vocabulary'),
				notStarted('taxonomy'),
				notStarted('thesaurus'),
				classes + properties + mine.length > 0
					? stage('ontology', 'in-progress', [
							...(classes + properties > 0
								? [
										{ label: 'Classes', value: classes, href: appUrl('/') },
										{ label: 'Properties', value: properties, href: appUrl('/') }
									]
								: []),
							...questionStats
						])
					: notStarted('ontology'),
				shapes > 0
					? stage('validation', 'in-progress', [{ label: 'Shapes', value: shapes, href: appUrl('/validation') }])
					: notStarted('validation'),
				individuals > 0
					? stage(
							'application',
							'in-progress',
							[{ label: 'Individuals', value: individuals, href: buildIdentitySearchUrl({ namespaceBaseIri: baseIri }) }],
							application
						)
					: notStarted('application')
			]
		};
	});
}

/** Questions linked to no class or property yet. They belong to no namespace, so they are shown once, apart
 *  from the namespace strips. */
export function unlinkedQuestionCount(questions: CompetencyQuestion[]): number {
	return questions.filter((q) => q.linkedElements.length === 0).length;
}

/** The namespaces that take part in the pipeline: those flagged "Part of the ontology pipeline". Used by the
 *  Overview and by its read-only review page alike, so the two always list the same namespaces. */
export function pipelineNamespaces<T extends { pipeline: boolean }>(namespaces: T[]): T[] {
	return namespaces.filter((n) => n.pipeline);
}
