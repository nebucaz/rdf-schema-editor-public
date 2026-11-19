import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import StagesTile from './StagesTile.svelte';
import { STAGE_IDS, type NamespaceSummary } from '#lib/services/pipeline-summary.js';

const summary = (prefix: string, over: Partial<Record<(typeof STAGE_IDS)[number], Partial<NamespaceSummary['stages'][number]>>> = {}): NamespaceSummary => ({
	namespaceBaseIri: `urn:ns:${prefix}`,
	prefix,
	stages: STAGE_IDS.map((stage) => ({ stage, status: 'not-started' as const, stats: [], warnings: 0, infos: 0, ...over[stage] }))
});

describe('StagesTile (STORY-471)', () => {
	it('is one table: a row per namespace and a column per stage in the method order', () => {
		render(StagesTile, { props: { summaries: [summary('hr'), summary('it')], pending: [] } });
		const table = screen.getByRole('table', { name: 'Stages by namespace' });
		expect(within(table).getAllByRole('columnheader').map((h) => h.textContent?.trim())).toEqual(['Namespace', 'Vocabulary', 'Taxonomy', 'Thesaurus', 'Ontology', 'Validation', 'Application']);
		expect(within(table).getAllByRole('rowheader').map((h) => h.textContent?.trim())).toEqual(['hr', 'it']);
	});

	it('shows counts as links, the findings and "Not started" for an empty stage', () => {
		render(StagesTile, {
			props: {
				summaries: [
					summary('hr', {
						ontology: {
							status: 'in-progress',
							stats: [{ label: 'Classes', value: 4 }, { label: 'Problems', value: 3, href: '/pipeline?tab=checks&stage=ontology' }],
							warnings: 2,
							infos: 1
						}
					})
				],
				pending: []
			}
		});
		const row = screen.getByRole('row', { name: /hr/ });
		const link = within(row).getByRole('link', { name: /Problems/ });
		expect(link.getAttribute('href')).toBe('/pipeline?tab=checks&stage=ontology');
		expect(row.textContent).toContain('Classes: 4');
		expect(row.textContent).toContain('2 warnings, 1 info');
		expect(within(row).getAllByText('Not started')).toHaveLength(5);
	});

	it('shows Loading for stages that still wait for data', () => {
		render(StagesTile, { props: { summaries: [summary('hr')], pending: ['application'] } });
		expect(screen.getAllByTestId('stage-loading')).toHaveLength(1);
		expect(screen.getAllByText('Not started')).toHaveLength(5);
	});

	it('says so when no namespace is part of the pipeline', () => {
		render(StagesTile, { props: { summaries: [], pending: [] } });
		expect(screen.getByTestId('no-pipeline-namespaces')).toBeInTheDocument();
		expect(screen.queryByRole('table')).toBeNull();
	});
});
